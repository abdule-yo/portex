//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"
)

const defaultMaxChars = 6000

func buildInjectPrompt(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return fail("buildInjectPrompt: need at least 2 args — input, provider")
	}

	input := args[0].String()
	provider := sanitizeProvider(args[1].String())
	maxChars := defaultMaxChars
	if len(args) >= 3 && !args[2].IsUndefined() && !args[2].IsNull() {
		if v := args[2].Int(); v > 0 {
			maxChars = v
		}
	}

	// Input can be a Session JSON or a plain summary string
	var session Session
	if err := json.Unmarshal([]byte(input), &session); err != nil {
		// Plain string fallback
		return ok(formatSummarizedPrompt(input, provider, maxChars))
	}

	if session.Summary != "" {
		return ok(formatSummarizedPrompt(session.Summary, provider, maxChars))
	}

	return ok(formatFullChatPrompt(session, provider, maxChars))
}

// formatSummarizedPrompt — used when a summary exists. Short, clean, natural.
func formatSummarizedPrompt(summary, provider string, maxChars int) string {
	if len(summary) > maxChars-200 {
		summary = summary[:maxChars-203] + "..."
	}

	switch provider {
	case "claude":
		return fmt.Sprintf(
			"Hey, picking up from where I left off. Here's what we covered:\n\n%s\n\nLet's continue from here.",
			summary,
		)
	case "gemini":
		return fmt.Sprintf(
			"Continuing from a previous session. Quick recap:\n\n%s\n\nLet's pick up where we left off.",
			summary,
		)
	default: // chatgpt
		return fmt.Sprintf(
			"Hey, continuing from an earlier conversation. Here's the recap:\n\n%s\n\nLet's keep going from here.",
			summary,
		)
	}
}

// formatFullChatPrompt — used when no summary exists. Formats the conversation
// cleanly so it reads naturally in a textarea.
func formatFullChatPrompt(session Session, provider string, maxChars int) string {
	title := session.Title
	if title == "" {
		title = "a previous chat"
	}

	sb := strings.Builder{}

	switch provider {
	case "claude":
		sb.WriteString(fmt.Sprintf("Picking up from %s. Here's the conversation so far:\n\n", title))
	case "gemini":
		sb.WriteString(fmt.Sprintf("Continuing from %s. Here's what we discussed:\n\n", title))
	default:
		sb.WriteString(fmt.Sprintf("Hey, I had a conversation (%s) and want to continue. Here's what happened:\n\n", title))
	}

	// Budget: maxChars minus the framing text and closing line
	budget := maxChars - sb.Len() - 60
	msgText := formatMessages(session.Messages, budget)
	sb.WriteString(msgText)

	sb.WriteString("\n\nLet's continue from here.")

	return sb.String()
}

// formatMessages builds a clean, readable transcript that fits within budget.
func formatMessages(messages []Message, budget int) string {
	if len(messages) == 0 {
		return "(empty conversation)"
	}

	// Try full transcript first
	full := renderMessages(messages)
	if len(full) <= budget {
		return full
	}

	// Too long — keep first 2 and last 4 messages, skip the middle
	if len(messages) <= 6 {
		return truncate(full, budget)
	}

	head := renderMessages(messages[:2])
	tail := renderMessages(messages[len(messages)-4:])
	skipped := len(messages) - 6

	result := fmt.Sprintf("%s\n\n... (%d earlier messages) ...\n\n%s", head, skipped, tail)
	if len(result) > budget {
		return truncate(result, budget)
	}
	return result
}

func renderMessages(messages []Message) string {
	parts := make([]string, 0, len(messages))
	for _, m := range messages {
		role := "Me"
		if m.Role == "assistant" {
			role = "AI"
		}
		// Trim overly long individual messages
		content := m.Content
		if len(content) > 800 {
			content = content[:797] + "..."
		}
		parts = append(parts, fmt.Sprintf("%s: %s", role, content))
	}
	return strings.Join(parts, "\n\n")
}

func buildSummarizePrompt(_ js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return fail("buildSummarizePrompt: need 1 arg — sessionJSON")
	}

	var session Session
	if err := json.Unmarshal([]byte(args[0].String()), &session); err != nil {
		return fail("buildSummarizePrompt: invalid session JSON — " + err.Error())
	}

	sb := strings.Builder{}
	sb.WriteString("Summarize the following conversation concisely. ")
	sb.WriteString("Preserve key decisions, code snippets, and important facts. ")
	sb.WriteString("Output plain text, no markdown headers.\n\n")

	for _, m := range session.Messages {
		sb.WriteString(fmtMsg(m))
		sb.WriteString("\n\n")
	}

	return ok(sb.String())
}
