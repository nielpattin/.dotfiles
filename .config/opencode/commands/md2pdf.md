---
description: Convert Markdown to PDF with custom styling
---

Convert the markdown file `$1` to PDF using md-to-pdf.

## User's Style Request
The user requested style: **$2**

## Available Styles
Find the matching style from these options in `~/.config/opencode/templates/`:

| Style Keyword | File | Description |
|---------------|------|-------------|
| `academic`, `university` | `academic.css` | Academic standard (Times New Roman, 13pt, binding margins) |
| `simple`, `minimal`, `clean` | `simple.css` | Clean minimal style (Arial, 11pt, equal margins) |
| `modern`, `tech`, `developer` | `modern.css` | Modern tech style (Inter/system font, syntax highlighting) |
| `report`, `business`, `corporate` | `business.css` | Professional business report style |

## Some Examples with Images
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

1. **Match the style**: Based on user's input "$2", determine which CSS file to use
2. **Show the user** which style you matched and its key features
3. **Ask for confirmation** before running the conversion
4. **Run the command** after user confirms:

```bash
md-to-pdf "$1" --stylesheet ~/.config/opencode/templates/<matched-style>.css
```

If no style argument is provided or style is not found, list all available styles and ask user to choose.

## Example Output
"I matched your request '$2' to the **academ* style:
- Font: Times New Roman, 13pt
- Margins: Left 30mm (binding), others 20-25mm
- H1: Uppercase, centered

Do you want me to convert `$1` with this style?"
