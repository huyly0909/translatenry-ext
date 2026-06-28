DIST_DIR     := dist
UNPACKED_DIR := $(DIST_DIR)/unpacked
VERSIONS_DIR := $(DIST_DIR)/versions
TIMESTAMP    := $(shell date +%Y%m%d-%H%M%S)
ZIP_NAME     := translatenry-$(TIMESTAMP).zip

# Source files to include
SRC_FILES := \
	manifest.json \
	rules.json \
	providers.js \
	background.js \
	content.js \
	content.css \
	popup.html \
	popup.css \
	popup.js \
	icons

.PHONY: build clean list

## Build: copy source → dist/unpacked/, zip → dist/versions/
build:
	@rm -rf $(UNPACKED_DIR)
	@mkdir -p $(UNPACKED_DIR) $(VERSIONS_DIR)
	@for f in $(SRC_FILES); do cp -r $$f $(UNPACKED_DIR)/; done
	@cd $(UNPACKED_DIR) && zip -q -r ../versions/$(ZIP_NAME) .
	@cp $(VERSIONS_DIR)/$(ZIP_NAME) $(DIST_DIR)/translatenry.zip
	@echo ""
	@echo "✅ $(UNPACKED_DIR)/         → Load unpacked in Chrome"
	@echo "✅ $(DIST_DIR)/translatenry.zip   → 🚀 File to upload to GitHub Release"
	@echo "✅ $(VERSIONS_DIR)/$(ZIP_NAME) → Archived version"
	@echo "   Size: $$(du -h $(DIST_DIR)/translatenry.zip | cut -f1)"

## Remove all outputs
clean:
	@rm -rf $(DIST_DIR)
	@echo "🗑  Cleaned $(DIST_DIR)/"

## List all builds (newest last)
list:
	@ls -lhtr $(VERSIONS_DIR)/*.zip 2>/dev/null || echo "No builds found. Run: make build"
