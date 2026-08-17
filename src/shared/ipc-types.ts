export interface IpcChannels {
  'get-notes': { args: []; return: string };
  'save-notes': { args: [notes: string]; return: { success: boolean; error?: string } };
  'get-attachments': { args: []; return: string };
  'save-attachments': { args: [attachments: string]; return: { success: boolean; error?: string } };
  'workspace-get-state': { args: []; return: string };
  'workspace-save-state': { args: [state: string]; return: { success: boolean; error?: string } };
  'workspace-open-path': { args: [target: string]; return: { success: boolean; path?: string; error?: string } };
  'export-word': { args: [title: string, content: string]; return: { success: boolean; path?: string; error?: string } };
  'export-pdf': { args: [title: string, content: string]; return: { success: boolean; path?: string; error?: string } };
}

export type IpcChannel = keyof IpcChannels;
export type IpcArgs<C extends IpcChannel> = IpcChannels[C]['args'];
export type IpcReturn<C extends IpcChannel> = IpcChannels[C]['return'];
