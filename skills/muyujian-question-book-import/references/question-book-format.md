# 暮雨笺题册 Markdown 格式 v1

The file name must be `questions.md`. It must be UTF-8 Markdown and start with this YAML front matter:

```md
---
format: muyujian-question-book/v1
book: 张宇一千题基础题
volume: 第一册
subject: 数学
---
```

`subject` must be one of `政治`, `英语`, `数学`, or `业务课`.

## Complete example

```md
---
format: muyujian-question-book/v1
book: 张宇一千题基础题
volume: 第一册
subject: 数学
---

# 第一章 极限

## Q001
状态: wrong
标签: 易错, 等价无穷小

### 题干
求 $\lim_{x \to 0}\frac{\sin x}{x}$。

![原题图片](source/page-001.png)

### 标准答案
极限为 $1$。

### 我的答案
$0$

### 错误原因
遗漏重要极限；原始解答使用了错误代换。

## Q002
状态: correct
标签: 连续性, 基础

### 题干
判断 $f(x)=x^2$ 在 $x=0$ 处是否连续。

### 标准答案
连续，因为函数在实数域连续。
```

## Grammar

- One `# ` heading declares a chapter. Keep question IDs unique inside the file.
- Every `## Q数字` question must include `状态`, `### 题干`, and `### 标准答案`.
- `### 我的答案` and `### 错误原因` are optional for `correct`, but required for `wrong` unless unavailable; when unavailable, write the reason explicitly.
- `标签` is optional and contains comma- or Chinese-comma-separated text.
- Store all linked image and attachment files below the same folder, preferably in `source/`.
- Do not use HTML tables, absolute paths, or duplicate `Q` IDs.

## Review Checklist

1. Front matter contains the exact `format` value.
2. Every image target is a relative path that exists beside the Markdown file.
3. Every question has a readable prompt and standard answer.
4. `wrong` never means "not yet passed"; it means the original response was wrong or incomplete.
5. Do not emit separate `correct.md` or `wrong.md`; the application creates those views from this source.
