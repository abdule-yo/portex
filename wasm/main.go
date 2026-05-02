//go:build js && wasm

package main

import "syscall/js"

func main() {
	done := make(chan struct{}, 0)

	js.Global().Set("parseSession", js.FuncOf(parseSession))
	js.Global().Set("summarizeSession", js.FuncOf(summarizeSession))
	js.Global().Set("buildInjectPrompt", js.FuncOf(buildInjectPrompt))
	js.Global().Set("serializeSession", js.FuncOf(serializeSession))
	js.Global().Set("deserializeSession", js.FuncOf(deserializeSession))
	js.Global().Set("generateSessionID", js.FuncOf(generateSessionID))
	js.Global().Set("searchSessions", js.FuncOf(searchSessions))
	js.Global().Set("callAIAPI", js.FuncOf(callAIAPI))
	js.Global().Set("addTag", js.FuncOf(addTag))
	js.Global().Set("removeTag", js.FuncOf(removeTag))

	js.Global().Set("wasmReady", js.ValueOf(true))

	<-done
}

func ok(data string) map[string]interface{} {
	return map[string]interface{}{"ok": true, "data": data}
}

func fail(msg string) map[string]interface{} {
	return map[string]interface{}{"ok": false, "error": msg}
}
