#!/usr/bin/env python3
"""Convert Markdown to a styled HTML and render to PDF using pyppeteer.

This script uses the `markdown` package to convert MD to HTML and `pyppeteer`
to render HTML to a high-quality PDF via headless Chromium.
"""

import asyncio
import os
import sys
from markdown import markdown

HTML_TEMPLATE = """
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>{title}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap');
body {{ font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; margin: 40px; color: #111827; background: #ffffff; }}
h1 {{ font-size: 28px; margin-bottom: 8px; }}
h2 {{ font-size: 20px; margin-top: 24px; }}
pre, code {{ background: #0f172a; color: #e6eef8; padding: 8px 10px; border-radius: 6px; font-family: 'SFMono-Regular', Menlo, Monaco, monospace; font-size: 11px; }}
pre {{ white-space: pre-wrap; word-wrap: break-word; padding: 12px; }}
.container {{ max-width: 900px; margin: auto; }}
.section {{ margin-bottom: 18px; padding-bottom: 6px; border-bottom: 1px solid #e6e9ef; }}
.meta {{ color: #6b7280; font-size: 13px; margin-bottom: 18px; }}
.code-block {{ background: #0b1220; padding: 12px; border-radius: 8px; color: #dbeafe; overflow-wrap: anywhere; }}
</style>
</head>
<body>
<div class="container">
{body}
</div>
</body>
</html>
"""


async def render_pdf(html_path, pdf_path):
    from pyppeteer import launch

    # Prefer system Chrome/Chromium if available to avoid pyppeteer's bundled binary issues
    possible_paths = [
        os.environ.get("CHROME_PATH"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    executable = None
    for p in possible_paths:
        if p and os.path.exists(p):
            executable = p
            break

    launch_kwargs = {"args": ["--no-sandbox"]}
    if executable:
        launch_kwargs["executablePath"] = executable

    page = None
    browser = await launch(**launch_kwargs)
    page = await browser.newPage()
    await page.goto("file://" + html_path)
    await page.pdf(
        {
            "path": pdf_path,
            "format": "A4",
            "printBackground": True,
            "margin": {
                "top": "20mm",
                "bottom": "20mm",
                "left": "15mm",
                "right": "15mm",
            },
        }
    )
    await browser.close()


def md_to_html(md_text, title="Report Snippets"):
    # Convert Markdown to HTML (with code fences preserved)
    body = markdown(md_text, extensions=["fenced_code", "codehilite"])
    return HTML_TEMPLATE.format(title=title, body=body)


async def main():
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    md_path = os.path.join(base, "REPORT_SNIPPETS.md")
    if not os.path.exists(md_path):
        print("Markdown file not found:", md_path)
        sys.exit(2)

    with open(md_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    html = md_to_html(md_text)
    html_path = os.path.splitext(md_path)[0] + ".html"
    pdf_path = os.path.splitext(md_path)[0] + ".pretty.pdf"

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    print("Rendered HTML to", html_path)
    await render_pdf(html_path, pdf_path)
    print("Generated pretty PDF:", pdf_path)


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
