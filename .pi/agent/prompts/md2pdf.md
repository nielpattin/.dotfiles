---
description: Convert Markdown to PDF with custom styling
---

Convert the markdown file `$2` to PDF using `md-to-pdf`.

## User Style Request
The user requested style: **$1**

## Available Styles
Match the user style to one of these CSS templates in `~/.pi/agent/templates/`:

| Style Keyword | File | Description |
|---------------|------|-------------|
| `academic`, `university` | `academic.css` | Academic standard (Times New Roman, 13pt, binding margins) |
| `simple`, `minimal`, `clean` | `simple.css` | Clean minimal style (Arial, 11pt, equal margins) |
| `modern`, `tech`, `developer` | `modern.css` | Modern tech style (Inter/system font, syntax highlighting) |
| `report`, `business`, `corporate` | `business.css` | Professional business report style |

## Image Examples
```markdown
<!-- Default: left-aligned, full width -->
![Left Aligned Full](image.jpg)

<!-- Left-aligned, 50% width -->
<img src="image.jpg" style="width: 50%;">

<!-- Centered, 50% width -->
<img src="image.jpg" style="display: block; width: 50%; margin: 0 auto;">

<!-- Centered, small fixed width -->
<img src="image.jpg" width="200" style="display: block; margin: 0 auto;">
```

## Instructions

1. Match the style from user input `$1` to one CSS file.
2. Tell the user which style you matched and summarize key features.
3. Ask for confirmation before running conversion.
4. After confirmation, run:

```bash
md-to-pdf "$2" --stylesheet "$HOME/.pi/agent/templates/<matched-style>.css"
```

If style is missing or cannot be matched, list all available styles and ask the user to choose.
