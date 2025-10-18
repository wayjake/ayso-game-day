// Server-only debug utilities for saving prompts/responses to files
import fs from 'fs/promises';
import path from 'path';

export async function savePromptToFile(systemPrompt: string, userMessage: string): Promise<string> {
  const debugDir = path.join(process.cwd(), 'debug');
  await fs.mkdir(debugDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const debugFile = path.join(debugDir, `${timestamp}-ai-lineup-prompt.txt`);
  await fs.writeFile(debugFile, `SYSTEM PROMPT:\n${systemPrompt}\n\n---\n\nUSER MESSAGE:\n${userMessage}`);
  console.log(`Debug prompt saved to: ${debugFile}`);
  return debugFile;
}

export async function saveResponseToFile(response: any, promptFile: string): Promise<void> {
  const responseFile = promptFile.replace('-prompt.txt', '-response.txt');
  await fs.writeFile(responseFile, JSON.stringify(response, null, 2));
  console.log(`Debug response saved to: ${responseFile}`);
}
