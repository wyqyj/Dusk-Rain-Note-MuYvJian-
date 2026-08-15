---
name: muyujian-question-book-import
description: Convert exam question images or text into the strict Markdown question-book format understood by MuYuJian v3. Use when users need to extract, classify, correct, or prepare question sets for import into the MuYuJian study workbench, especially after a separate AI/OCR workflow has read source images.
---

# 暮雨笺题册整理

Prepare only importable Markdown. Do not invoke an external AI service from the application. Accept source images, OCR text, or manually supplied questions, then emit a `questions.md` that conforms exactly to the format in [references/question-book-format.md](references/question-book-format.md). For ready-to-send instructions, read [references/agent-prompts.md](references/agent-prompts.md).

## Required Workflow

1. Read the format reference before creating or revising a question book.
2. Preserve the question order from the source and assign zero-padded IDs such as `Q001`. Split separately numbered source questions into separate IDs; never combine two questions under one ID.
3. Put every question under one `# 章节` heading and one `## Q编号` heading. Each `## Q编号` block represents exactly one question for one-at-a-time review.
4. Set `状态: correct` only when the original attempt is correct. Set `状态: wrong` for incorrect, incomplete, uncertain, or missing attempts.
5. Include `### 题干` and `### 标准答案` for every question. Never invent a standard answer. State uncertainty in `### 错误原因` when evidence is incomplete.
6. Write inline formulas as `$...$` and display formulas as `$$...$$`. Convert formula-like Markdown inline code such as `` `x^2` `` to formula delimiters; never wrap formulas in backticks. Retain image references as relative paths under `source/`.
7. Use one concise tag line. Tags describe concepts or review priorities, not duplicate status.
8. Validate required fields, headings, question boundaries, and formula delimiters before returning the result. Return the final folder layout and the complete `questions.md`, without explanatory prose inside the file.

## Classification Rules

- Use `wrong` when the response is absent, partially correct, unreadable, or cannot be verified.
- Explain the gap in `错误原因`, for example `原图未包含完整推导，无法确认中间步骤。`.
- Do not convert a `wrong` item to `correct` merely because a user later redoes it successfully. The application stores redo/pass state separately.
- Keep correct and wrong items mixed in original chapter/question order. The application creates filtered views itself.

## Output Contract

Create this layout:

```text
书名/
  分册名/
    questions.md
    source/
      page-001.png
```

Use paths relative to `questions.md`, never absolute file paths. Read [references/question-book-format.md](references/question-book-format.md) for the complete schema and valid example.
