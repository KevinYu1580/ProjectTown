.PHONY: dev test-web test-swift check app clean

XCODEBUILD = xcodebuild -project ProjectTown.xcodeproj -scheme ProjectTown -configuration Debug -derivedDataPath build/DerivedData build

web/node_modules: web/package-lock.json
	cd web && npm ci
	touch web/node_modules

dev: web/node_modules
	cd web && npm run dev

test-web: web/node_modules
	cd web && npm run typecheck
	cd web && npm run lint
	cd web && npm test
	cd web && npm run e2e

test-swift:
	cd Packages/ProjectTownCore && swift test
	xcodegen generate
	$(XCODEBUILD)

check: test-web test-swift

app: web/node_modules
	cd web && npm run build
	xcodegen generate
	$(XCODEBUILD)
	rm -rf build/ProjectTown.app
	ditto build/DerivedData/Build/Products/Debug/ProjectTown.app build/ProjectTown.app
	open build/ProjectTown.app

clean:
	rm -rf build ProjectTown.xcodeproj Packages/ProjectTownCore/.build web/dist web/test-results web/playwright-report
