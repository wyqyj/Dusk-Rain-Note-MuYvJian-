export interface ParsedPlanTask {
  title: string;
  completed: boolean;
}

/** Parse Markdown task list items without guessing subject or deadline metadata. */
export function parseMarkdownTasks(content: string): ParsedPlanTask[] {
  const tasks: ParsedPlanTask[] = [];
  const taskPattern = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/;
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(taskPattern);
    const title = match?.[2]?.trim();
    if (!match || !title) continue;
    tasks.push({ title, completed: match[1]?.toLowerCase() === 'x' });
  }
  return tasks;
}
