# Design Guidelines

Source: [Base-design.pen](/Users/jessevaughan/Projects/Meeting-notes/design/Base-design.pen)

This file is intentionally lightweight. It captures the basic visual tokens from the `.pen` file without prescribing component structure or layout rules.

## Colors

### Primary

| Token | Value |
| --- | --- |
| `--accent` | `#2D6B3F` |
| `--accent-hover` | `#245533` |
| `--accent-muted` | `#2D6B3F1A` |

### Surfaces

| Token | Value |
| --- | --- |
| `--bg-primary` | `#FFFFFF` |
| `--bg-secondary` | `#F4F5F5` |
| `--bg-tertiary` | `#EAEBEB` |
| `--bg-hover` | `#EDEFED` |
| `--bg-active` | `#E5E8E5` |

### Text

| Token | Value |
| --- | --- |
| `--text-primary` | `#1E3322` |
| `--text-secondary` | `#6B7B6B` |
| `--text-tertiary` | `#808A80` |
| `--text-disabled` | `#B0B8B0` |
| `--text-inverse` | `#FFFFFF` |

### Borders

| Token | Value |
| --- | --- |
| `--border-default` | `#D0D4D0` |
| `--border-strong` | `#B0B8B0` |
| `--border-subtle` | `#E8E9E8` |
| `--border-focus` | `#2D6B3F` |

### Status

| Token | Value |
| --- | --- |
| `--success` | `#2D6B3F` |
| `--warning` | `#E8A800` |
| `--warning-text` | `#B08600` |
| `--error` | `#D93025` |
| `--info` | `#3B82C4` |
| `--recording` | `#D93025` |

## Typography

| Token | Value |
| --- | --- |
| `--font-body` | `Geist` |
| `--font-sans` | `Geist` |
| `--font-mono` | `IBM Plex Mono` |
| `--font-heading` | `Playfair Display` |
| `--font-caption` | `Inter` |

### Common Sizes

- `20px` large heading
- `16px` section heading / strong label
- `14px` default UI text
- `12px` small label
- `11-13px` mono metadata

## Radius

| Token | Value |
| --- | --- |
| `--radius-sm` | `4px` |
| `--radius-md` | `8px` |
| `--radius-lg` | `16px` |
| `--radius-pill` | `9999px` |

## Spacing

Common spacing values found in the file:

- `4px`
- `8px`
- `12px`
- `16px`
- `24px`
- `32px`
- `40px`

## Basic Usage Notes

- Use `Geist` as the default interface font.
- Use `IBM Plex Mono` for technical metadata, file paths, timings, and machine-like labels.
- Use the green accent sparingly as the primary brand color.
- Keep most surfaces neutral and lightly bordered.
- Default to `8px` radius and `16px` spacing unless there is a clear reason not to.
