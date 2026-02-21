BINARY   := portex.wasm
OUT_DIR  := ../extension

.PHONY: build copy-exec clean compress dev

## build: compile Go → WASM and copy wasm_exec.js
build: copy-exec
	GOOS=js GOARCH=wasm go build \
		-trimpath \
		-ldflags="-s -w" \
		-o $(OUT_DIR)/$(BINARY) \
		.
	@echo "✓ Built $(OUT_DIR)/$(BINARY)"

## copy-exec: copy the Go runtime WASM helper from the installed Go toolchain
copy-exec:
	@cp "$$(go env GOROOT)/misc/wasm/wasm_exec.js" $(OUT_DIR)/wasm_exec.js
	@echo "✓ Copied wasm_exec.js"

## clean: remove build artifacts
clean:
	rm -f $(OUT_DIR)/$(BINARY) $(OUT_DIR)/wasm_exec.js

## compress: optional post-build binary optimisation (requires binaryen)
## Install: brew install binaryen
compress: build
	@if command -v wasm-opt >/dev/null 2>&1; then \
		wasm-opt -Oz --enable-bulk-memory \
			-o $(OUT_DIR)/$(BINARY) $(OUT_DIR)/$(BINARY) && \
		echo "✓ Compressed with wasm-opt"; \
	else \
		echo "⚠  wasm-opt not found (brew install binaryen). Skipping compression."; \
	fi

## dev: build and report final binary size
dev: build
	@ls -lh $(OUT_DIR)/$(BINARY)
