//go:build js && wasm

package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"
	"time"
)

type Message struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"`
}

type Session struct {
	ID        string    `json:"id"`
	Provider  string    `json:"provider"`
	Timestamp int64     `json:"timestamp"`
	Tags      []string  `json:"tags"`
	Messages  []Message `json:"messages"`
	Summary   string    `json:"summary"`
	Title     string    `json:"title"`
}

func parseSession(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return fail("parseSession: need 2 args — provider, rawMessagesJSON")
	}

	provider := sanitizeProvider(args[0].String())
	rawJSON := args[1].String()

	var rawMessages []map[string]string
	if err := json.Unmarshal([]byte(rawJSON), &rawMessages); err != nil {
		return fail("parseSession: invalid JSON — " + err.Error())
	}

	messages := make([]Message, 0, len(rawMessages))
	for _, raw := range rawMessages {
		role := normalizeRole(raw["role"])
		content := cleanContent(raw["content"])
		if content == "" {
			continue
		}
		messages = append(messages, Message{
			Role:      role,
			Content:   content,
			Timestamp: time.Now().UnixMilli(),
		})
	}

	if len(messages) == 0 {
		return fail("parseSession: no messages found after parsing")
	}

	session := Session{
		ID:        newUUID(),
		Provider:  provider,
		Timestamp: time.Now().UnixMilli(),
		Tags:      []string{},
		Messages:  messages,
		Title:     extractTitle(messages),
	}

	data, err := json.Marshal(session)
	if err != nil {
		return fail("parseSession: serialization error — " + err.Error())
	}

	return ok(string(data))
}

func normalizeRole(role string) string {
	role = strings.ToLower(strings.TrimSpace(role))
	switch {
	case role == "user", role == "human":
		return "user"
	case role == "assistant", role == "ai", role == "model", role == "bot":
		return "assistant"
	default:
		if strings.Contains(role, "user") || strings.Contains(role, "human") {
			return "user"
		}
		return "assistant"
	}
}

func cleanContent(content string) string {
	lines := strings.Split(strings.TrimSpace(content), "\n")
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		if t := strings.TrimSpace(l); t != "" {
			out = append(out, t)
		}
	}
	return strings.Join(out, "\n")
}

func extractTitle(messages []Message) string {
	for _, m := range messages {
		if m.Role == "user" && m.Content != "" {
			if len(m.Content) > 60 {
				return m.Content[:57] + "..."
			}
			return m.Content
		}
	}
	return "Untitled Session"
}

// Only allow known provider names through
func sanitizeProvider(p string) string {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "chatgpt":
		return "chatgpt"
	case "claude":
		return "claude"
	case "gemini":
		return "gemini"
	default:
		return "unknown"
	}
}

func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
