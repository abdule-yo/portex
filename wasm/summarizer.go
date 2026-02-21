//go:build js && wasm

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"syscall/js"
)

const (
	keepRecentN   = 10
	maxSummaryLen = 4000
)

func summarizeSession(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return fail("summarizeSession: need 1 arg — sessionJSON")
	}

	var session Session
	if err := json.Unmarshal([]byte(args[0].String()), &session); err != nil {
		return fail("summarizeSession: invalid session JSON — " + err.Error())
	}

	return ok(buildLayeredSummary(session.Messages))
}

// Three-tier compression: old → one-liner pairs, middle → key facts, recent N → verbatim
func buildLayeredSummary(messages []Message) string {
	if len(messages) == 0 {
		return ""
	}

	if len(messages) <= keepRecentN {
		parts := make([]string, 0, len(messages))
		for _, m := range messages {
			parts = append(parts, fmtMsg(m))
		}
		return strings.Join(parts, "\n\n")
	}

	totalOld := len(messages) - keepRecentN
	oldEnd := totalOld / 2
	middleEnd := totalOld

	old := messages[:oldEnd]
	middle := messages[oldEnd:middleEnd]
	recent := messages[middleEnd:]

	var sb strings.Builder

	if len(old) > 0 {
		sb.WriteString("=== Early conversation (compressed) ===\n")
		sb.WriteString(compressOld(old))
		sb.WriteString("\n\n")
	}
	if len(middle) > 0 {
		sb.WriteString("=== Key points ===\n")
		sb.WriteString(compressMiddle(middle))
		sb.WriteString("\n\n")
	}
	sb.WriteString("=== Recent messages ===\n")
	for _, m := range recent {
		sb.WriteString(fmtMsg(m))
		sb.WriteString("\n\n")
	}

	result := strings.TrimSpace(sb.String())
	if len(result) > maxSummaryLen {
		result = result[:maxSummaryLen-3] + "..."
	}
	return result
}

func compressOld(messages []Message) string {
	parts := make([]string, 0, len(messages)/2+1)
	for i := 0; i < len(messages); i += 2 {
		q := truncate(messages[i].Content, 80)
		if i+1 < len(messages) {
			a := truncate(messages[i+1].Content, 80)
			parts = append(parts, "Q: "+q+" → A: "+a)
		} else {
			parts = append(parts, "Q: "+q)
		}
	}
	return strings.Join(parts, "\n")
}

func compressMiddle(messages []Message) string {
	facts := make([]string, 0, len(messages))
	for _, m := range messages {
		if m.Role != "assistant" {
			continue
		}
		sentences := strings.SplitN(m.Content, ".", 3)
		if len(sentences) > 0 {
			if fact := strings.TrimSpace(sentences[0]); len(fact) > 20 {
				facts = append(facts, "• "+truncate(fact, 120))
			}
		}
	}
	if len(facts) == 0 {
		return "(no key points extracted)"
	}
	return strings.Join(facts, "\n")
}

func fmtMsg(m Message) string {
	role := "User"
	if m.Role == "assistant" {
		role = "Assistant"
	}
	return role + ": " + m.Content
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-3] + "..."
}

// Returns a JS Promise so the HTTP call runs in a goroutine without blocking WASM
func callAIAPI(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return fail("callAIAPI: need 3 args — apiKey, model, prompt")
	}

	apiKey := strings.TrimSpace(args[0].String())
	model := strings.TrimSpace(args[1].String())
	prompt := args[2].String()

	if apiKey == "" {
		return fail("callAIAPI: apiKey is required")
	}
	if model == "" {
		return fail("callAIAPI: model is required")
	}

	handler := js.FuncOf(func(_ js.Value, promiseArgs []js.Value) interface{} {
		resolve := promiseArgs[0]
		reject := promiseArgs[1]

		go func() {
			var (
				result string
				err    error
			)
			if strings.HasPrefix(model, "claude") {
				result, err = callAnthropic(apiKey, model, prompt)
			} else {
				result, err = callOpenAI(apiKey, model, prompt)
			}

			if err != nil {
				reject.Invoke(js.ValueOf(err.Error()))
				return
			}
			resolve.Invoke(js.ValueOf(map[string]interface{}{
				"ok":   true,
				"data": result,
			}))
		}()

		return nil
	})

	return js.Global().Get("Promise").New(handler)
}

type openAIRequest struct {
	Model    string          `json:"model"`
	Messages []openAIMessage `json:"messages"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func callOpenAI(apiKey, model, prompt string) (string, error) {
	payload := openAIRequest{
		Model:    model,
		Messages: []openAIMessage{{Role: "user", Content: prompt}},
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", "https://api.openai.com/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("openai request build: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("openai request: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("openai read body: %w", err)
	}

	var result openAIResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("openai parse response: %w", err)
	}
	if result.Error != nil {
		return "", fmt.Errorf("openai API error: %s", result.Error.Message)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("openai: no choices returned")
	}

	return strings.TrimSpace(result.Choices[0].Message.Content), nil
}

type anthropicRequest struct {
	Model     string          `json:"model"`
	MaxTokens int             `json:"max_tokens"`
	Messages  []openAIMessage `json:"messages"`
}

type anthropicResponse struct {
	Content []struct {
		Text string `json:"text"`
	} `json:"content"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func callAnthropic(apiKey, model, prompt string) (string, error) {
	payload := anthropicRequest{
		Model:     model,
		MaxTokens: 1024,
		Messages:  []openAIMessage{{Role: "user", Content: prompt}},
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("anthropic request build: %w", err)
	}
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("anthropic request: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("anthropic read body: %w", err)
	}

	var result anthropicResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("anthropic parse response: %w", err)
	}
	if result.Error != nil {
		return "", fmt.Errorf("anthropic API error: %s", result.Error.Message)
	}
	if len(result.Content) == 0 {
		return "", fmt.Errorf("anthropic: no content returned")
	}

	return strings.TrimSpace(result.Content[0].Text), nil
}
