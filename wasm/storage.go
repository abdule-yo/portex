//go:build js && wasm

package main

import (
	"encoding/json"
	"strings"
	"syscall/js"
)

func generateSessionID(this js.Value, args []js.Value) interface{} {
	return ok(newUUID())
}

func serializeSession(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return fail("serializeSession: need 1 arg — sessionJSON")
	}

	var session Session
	if err := json.Unmarshal([]byte(args[0].String()), &session); err != nil {
		return fail("serializeSession: invalid JSON — " + err.Error())
	}

	data, err := json.Marshal(session)
	if err != nil {
		return fail("serializeSession: marshal error — " + err.Error())
	}
	return ok(string(data))
}

func deserializeSession(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return fail("deserializeSession: need 1 arg — sessionJSON")
	}

	var session Session
	if err := json.Unmarshal([]byte(args[0].String()), &session); err != nil {
		return fail("deserializeSession: invalid JSON — " + err.Error())
	}

	data, err := json.Marshal(session)
	if err != nil {
		return fail("deserializeSession: marshal error — " + err.Error())
	}
	return ok(string(data))
}

func searchSessions(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return fail("searchSessions: need 2 args — sessionsJSON, keyword")
	}

	var sessions []Session
	if err := json.Unmarshal([]byte(args[0].String()), &sessions); err != nil {
		return fail("searchSessions: invalid sessions JSON — " + err.Error())
	}

	keyword := strings.ToLower(strings.TrimSpace(args[1].String()))

	if keyword == "" {
		data, _ := json.Marshal(sessions)
		return ok(string(data))
	}

	matched := make([]Session, 0, len(sessions))
	for _, s := range sessions {
		if sessionMatchesKeyword(s, keyword) {
			matched = append(matched, s)
		}
	}

	data, err := json.Marshal(matched)
	if err != nil {
		return fail("searchSessions: marshal error — " + err.Error())
	}
	return ok(string(data))
}

func sessionMatchesKeyword(s Session, kw string) bool {
	if strings.Contains(strings.ToLower(s.Title), kw) {
		return true
	}
	if strings.Contains(strings.ToLower(s.Summary), kw) {
		return true
	}
	if strings.Contains(strings.ToLower(s.Provider), kw) {
		return true
	}
	for _, tag := range s.Tags {
		if strings.Contains(strings.ToLower(tag), kw) {
			return true
		}
	}
	for _, m := range s.Messages {
		if strings.Contains(strings.ToLower(m.Content), kw) {
			return true
		}
	}
	return false
}

// addTag appends a unique, non-empty tag to the session's tag list.
func addTag(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return fail("addTag: need 2 args — sessionJSON, tag")
	}

	var session Session
	if err := json.Unmarshal([]byte(args[0].String()), &session); err != nil {
		return fail("addTag: invalid session JSON — " + err.Error())
	}

	tag := strings.TrimSpace(args[1].String())
	if tag == "" {
		return fail("addTag: tag must not be empty")
	}

	// Deduplicate — case-insensitive
	for _, existing := range session.Tags {
		if strings.EqualFold(existing, tag) {
			data, _ := json.Marshal(session)
			return ok(string(data))
		}
	}

	session.Tags = append(session.Tags, tag)

	data, err := json.Marshal(session)
	if err != nil {
		return fail("addTag: marshal error — " + err.Error())
	}
	return ok(string(data))
}

// removeTag deletes a tag from the session's tag list (case-insensitive).
func removeTag(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return fail("removeTag: need 2 args — sessionJSON, tag")
	}

	var session Session
	if err := json.Unmarshal([]byte(args[0].String()), &session); err != nil {
		return fail("removeTag: invalid session JSON — " + err.Error())
	}

	tag := strings.TrimSpace(args[1].String())

	filtered := session.Tags[:0]
	for _, t := range session.Tags {
		if !strings.EqualFold(t, tag) {
			filtered = append(filtered, t)
		}
	}
	session.Tags = filtered
	if session.Tags == nil {
		session.Tags = []string{}
	}

	data, err := json.Marshal(session)
	if err != nil {
		return fail("removeTag: marshal error — " + err.Error())
	}
	return ok(string(data))
}
