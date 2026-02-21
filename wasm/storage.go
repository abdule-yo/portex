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
