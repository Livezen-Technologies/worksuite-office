import importlib.util
from pathlib import Path
import json
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("product_name", Path(__file__).parents[1] / "patch-engine-branding.py")
brand = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brand)


class ProductNameTests(unittest.TestCase):
    def test_online_branding_without_desktop_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            web = root / "web-apps"
            (web / "apps/mobile/locale").mkdir(parents=True)
            (web / "build").mkdir()
            (web / "apps/index.html").write_text('<title>ONLYOFFICE PDF Editor</title>')
            (web / "apps/mobile/locale/fr.json").write_text('{"about":"À propos de ONLYOFFICE"}')
            (web / "build/Gruntfile.js").write_text(
                "_encode(process.env.APP_TITLE_TEXT) || 'ONLYOFFICE';\n"
                "process.env['APP_CUSTOMER_NAME'] || 'ONLYOFFICE';\n")
            for component in ("core", "sdkjs", "desktop-sdk", "server"):
                (root / component).mkdir()
                (root / component / "README.md").write_text('# Original name\n\nOriginal text\n')
            brand.patch(web)
            self.assertEqual((web / "apps/index.html").read_text(), '<title>WorkSuite Office PDF Editor</title>')
            self.assertIn('À propos de WorkSuite Office', (web / "apps/mobile/locale/fr.json").read_text())
            self.assertNotIn("ONLYOFFICE", (web / "build/Gruntfile.js").read_text())
            self.assertTrue((root / "core/README.md").read_text().startswith('# WorkSuite Document Engine\n'))
            self.assertTrue((root / "sdkjs/README.md").read_text().startswith('# WorkSuite Office SDK\n'))
            self.assertTrue((root / "server/README.md").read_text().startswith('# WorkSuite Document Server\n'))

    def test_prose_and_compatibility_identifiers(self):
        text = ('#define APP_TITLE "WorkSuite Office"\n'
                '#define SECRET_SERVICE "WorkSuite Office"\n'
                '# define REG_UNINST_KEY "WorkSuite Office"\n'
                '"ONLYOFFICE can not open the file."\n'
                '"https://github.com/ONLYOFFICE/web-apps"\n'
                '"ONLYOFFICE/Resources/Info.plist"\n'
                '"Copyright © ONLYOFFICE, WorkSuite Office"\n')
        result = brand.rename_text(text)
        self.assertIn('#define APP_TITLE "WorkSuite Office"', result)
        self.assertIn('#define SECRET_SERVICE "WorkSuite Office"', result)
        self.assertIn('# define REG_UNINST_KEY "WorkSuite Office"', result)
        self.assertIn('"WorkSuite Office can not open the file."', result)
        self.assertIn('"https://github.com/ONLYOFFICE/web-apps"', result)
        self.assertIn('"ONLYOFFICE/Resources/Info.plist"', result)
        self.assertIn('"Copyright © ONLYOFFICE, WorkSuite Office"', result)

    def test_resource_encodings_theme_package_and_repeat_run(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            desktop, web = root / "desktop", root / "web"

            def put(path, text, encoding="utf-8"):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(text.encode(encoding))

            put(desktop / "win-linux/src/defines.h", '#define APP_TITLE "WorkSuite Office"\n')
            put(desktop / "package/inno/defines.iss",
                '#define sProductName "Office"\n'
                '#define APP_REG_UNINST_KEY str(sCompanyName + " " + sProductName)\n')
            put(desktop / "package/Makefile",
                "PRODUCT_NAME ?= Office\nM4_PRODUCT_NAME='$(PRODUCT_NAME)'\n'_product_name $(PRODUCT_NAME)'\n")
            put(desktop / ".docker/desktop-apps.bake.Dockerfile",
                'ENV ABOUT_PAGE_APP_NAME="${COMPANY_NAME} ${PRODUCT_NAME}"\n')
            for mode in ("light", "dark"):
                put(desktop / f"win-linux/res/icons/logo-{mode}-eo.svg",
                    '<svg><text>WorkSuite Office</text></svg>')
            put(desktop / "win-linux/res/styles/styles@1.5x.qss", 'url(:/logo-light-eo_1.5x.png)')
            put(desktop / "common/loginpage/res/img/idx-logo-light-eo.svg", '<svg id="worksuite"/>')
            localized = desktop / "macos/ONLYOFFICE/fr.lproj/Main.strings"
            put(localized, '"about.title" = "À propos de WorkSuite Office";', "utf-16")
            legal = desktop / "package/common/license/LICENSE.html"
            put(legal, 'WorkSuite Office / ONLYOFFICE license')
            source = desktop / "common/loginpage/src/example.js"
            put(source, '/* WorkSuite Office copyright */\nconst title = "WorkSuite Office";')
            theme = web / "theme/euro-office/meta/config.json"
            put(theme, json.dumps({"app_title": "Euro Office", "attribution": "Original credits"}))

            (web / "apps").mkdir(parents=True, exist_ok=True)
            brand.patch(web, desktop)
            self.assertIn('À propos de WorkSuite Office', localized.read_text(encoding="utf-16"))
            self.assertTrue(localized.read_bytes().startswith(b"\xff\xfe"))
            self.assertEqual(legal.read_text(), 'WorkSuite Office / ONLYOFFICE license')
            self.assertTrue(source.read_text().startswith('/* WorkSuite Office copyright */'))
            self.assertEqual(json.loads(theme.read_text())["app_title"], brand.DISPLAY_NAME)
            self.assertEqual(json.loads(theme.read_text())["attribution"], "Original credits")
            installer = (desktop / "package/inno/defines.iss").read_text()
            self.assertIn('#define sProductName "Office"', installer)
            self.assertIn('#define APP_REG_UNINST_KEY str(sCompanyName', installer)
            makefile = (desktop / "package/Makefile").read_text()
            self.assertIn('PRODUCT_NAME ?= Office', makefile)
            self.assertIn("M4_PRODUCT_NAME='$(PRODUCT_NAME)'", makefile)
            self.assertIn('logo-light-eo.svg', (desktop / "win-linux/res/styles/styles@1.5x.qss").read_text())
            before = {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            brand.patch(web, desktop)
            self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()})


if __name__ == "__main__":
    unittest.main()
