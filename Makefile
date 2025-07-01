# Network Share Automount Extension Makefile
UUID = network-share-automount@gavindi.github.com
DESTDIR = ~/.local/share/gnome-shell/extensions/$(UUID)
SYSTEM_DESTDIR = /usr/share/gnome-shell/extensions/$(UUID)

# Source files to copy
SOURCES = extension.js prefs.js metadata.json
SCHEMAS = schemas/org.gnome.shell.extensions.network-share-automount.gschema.xml
BUILD_DIR = build

# Default target
all: build

# Build the extension
build: clean
	@echo "Building extension..."
	@mkdir -p $(BUILD_DIR)
	@cp $(SOURCES) $(BUILD_DIR)/
	@mkdir -p $(BUILD_DIR)/schemas
	@cp $(SCHEMAS) $(BUILD_DIR)/schemas/
	@if [ -d "icons" ]; then \
		echo "Copying icons directory..."; \
		cp -r icons $(BUILD_DIR)/; \
	else \
		echo "Warning: icons directory not found, creating empty icons directory"; \
		mkdir -p $(BUILD_DIR)/icons; \
	fi
	@echo "Compiling schemas..."
	@glib-compile-schemas $(BUILD_DIR)/schemas/
	@echo "Build complete!"

# Install to user directory (recommended)
install: build
	@echo "Installing extension to user directory..."
	@mkdir -p $(DESTDIR)
	@cp -r $(BUILD_DIR)/* $(DESTDIR)/
	@echo "Extension installed to $(DESTDIR)"
	@echo "Enable with: gnome-extensions enable $(UUID)"

# Install to system directory (requires sudo)
install-system: build
	@echo "Installing extension to system directory..."
	@sudo mkdir -p $(SYSTEM_DESTDIR)
	@sudo cp -r $(BUILD_DIR)/* $(SYSTEM_DESTDIR)/
	@echo "Extension installed to $(SYSTEM_DESTDIR)"
	@echo "Enable with: gnome-extensions enable $(UUID)"

# Enable the extension
enable:
	@echo "Enabling extension..."
	@gnome-extensions enable $(UUID)

# Disable the extension
disable:
	@echo "Disabling extension..."
	@gnome-extensions disable $(UUID)

# Development workflow - clean, build, install, and enable
dev: clean build install enable
	@echo "Development installation complete!"

# Check extension status
status:
	@echo "Extension status:"
	@gnome-extensions list --enabled | grep $(UUID) && echo "✓ Enabled" || echo "✗ Disabled"
	@gnome-extensions list --user | grep $(UUID) && echo "✓ Installed (user)" || echo "✗ Not installed (user)"
	@if [ -d "$(SYSTEM_DESTDIR)" ]; then echo "✓ Installed (system)"; fi

# Restart GNOME Shell (X11 only)
restart-shell:
	@echo "Restarting GNOME Shell (X11 only)..."
	@busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting…")'

# Create distribution package
dist: build
	@echo "Creating distribution package..."
	@cd $(BUILD_DIR) && zip -r ../$(UUID)-v$(shell grep '"version"' metadata.json | cut -d':' -f2 | tr -d ' ,"').zip .
	@echo "Distribution package created: $(UUID)-v$(shell grep '"version"' metadata.json | cut -d':' -f2 | tr -d ' ,"').zip"

# Clean build directory
clean:
	@echo "Cleaning build directory..."
	@rm -rf $(BUILD_DIR)
	@rm -f *.zip

# Uninstall from user directory
uninstall:
	@echo "Uninstalling extension from user directory..."
	@gnome-extensions disable $(UUID) 2>/dev/null || true
	@rm -rf $(DESTDIR)
	@echo "Extension uninstalled"

# Uninstall from system directory
uninstall-system:
	@echo "Uninstalling extension from system directory..."
	@gnome-extensions disable $(UUID) 2>/dev/null || true
	@sudo rm -rf $(SYSTEM_DESTDIR)
	@echo "Extension uninstalled from system"

# View logs
logs:
	@echo "Viewing extension logs (Ctrl+C to exit)..."
	@journalctl -f -o cat /usr/bin/gnome-shell | grep -i network

# Validate extension files
validate:
	@echo "Validating extension files..."
	@for file in $(SOURCES); do \
		if [ ! -f "$$file" ]; then \
			echo "✗ Missing required file: $$file"; \
			exit 1; \
		else \
			echo "✓ Found: $$file"; \
		fi; \
	done
	@if [ ! -f "$(SCHEMAS)" ]; then \
		echo "✗ Missing schema file: $(SCHEMAS)"; \
		exit 1; \
	else \
		echo "✓ Found: $(SCHEMAS)"; \
	fi
	@if [ -d "icons" ]; then \
		echo "✓ Found: icons directory"; \
		@find icons -name "*.svg" -type f | while read icon; do \
			echo "  ✓ Icon: $$icon"; \
		done; \
	else \
		echo "⚠ Warning: icons directory not found"; \
	fi
	@echo "Validation complete!"

# Development helpers
reload: disable enable
	@echo "Extension reloaded!"

watch:
	@echo "Watching for file changes (Ctrl+C to stop)..."
	@while true; do \
		inotifywait -r -e modify,create,delete . 2>/dev/null && \
		echo "Files changed, rebuilding..." && \
		make dev; \
	done

# Quick install and test
quick: dev
	@echo "Quick installation complete! Check status:"
	@make status

# Help target
help:
	@echo "Available targets:"
	@echo "  build          - Build the extension"
	@echo "  install        - Install to user directory (recommended)"
	@echo "  install-system - Install to system directory (requires sudo)"
	@echo "  enable         - Enable the extension"
	@echo "  disable        - Disable the extension"
	@echo "  dev            - Full development cycle (clean, build, install, enable)"
	@echo "  status         - Check extension installation and status"
	@echo "  restart-shell  - Restart GNOME Shell (X11 only)"
	@echo "  dist           - Create distribution zip package"
	@echo "  clean          - Clean build directory"
	@echo "  uninstall      - Uninstall from user directory"
	@echo "  uninstall-system - Uninstall from system directory"
	@echo "  logs           - View extension logs"
	@echo "  validate       - Validate extension files"
	@echo "  reload         - Disable and re-enable extension"
	@echo "  watch          - Watch for file changes and auto-rebuild"
	@echo "  quick          - Quick install and status check"
	@echo "  help           - Show this help message"

.PHONY: all build install install-system enable disable dev status restart-shell dist clean uninstall uninstall-system logs validate reload watch quick help