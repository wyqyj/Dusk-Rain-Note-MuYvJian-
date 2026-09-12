import { describe, expect, it } from 'vitest';
import {
  attachmentTokenToUrl,
  isAttachmentToken,
  resolveAttachmentTokens,
  setAttachmentRoot,
} from './attachmentRef';

describe('attachment 令牌', () => {
  it('识别 attachment: 前缀', () => {
    expect(isAttachmentToken('attachment:abc.png')).toBe(true);
    expect(isAttachmentToken('data:image/png;base64,x')).toBe(false);
  });

  it('未设置根路径时解析为空串', () => {
    setAttachmentRoot('');
    expect(attachmentTokenToUrl('attachment:a.png')).toBe('');
  });

  it('基于根路径生成 file:// URL 并转义文件名', () => {
    setAttachmentRoot('D:\\notes\\工作台');
    expect(attachmentTokenToUrl('attachment:图 1.png')).toBe(
      'file:///D:/notes/工作台/attachments/%E5%9B%BE%201.png'
    );
  });

  it('文件名中的路径分隔符被剔除，防止越界', () => {
    setAttachmentRoot('/data');
    expect(attachmentTokenToUrl('attachment:../secret.png')).toBe('file:///data/attachments/..secret.png');
  });

  it('resolveAttachmentTokens 只替换 src/href 中的令牌', () => {
    setAttachmentRoot('/data');
    const html = '<p>attachment:not-a-file</p><img src="attachment:a.png"><a href="attachment:doc.pdf">x</a>';
    const out = resolveAttachmentTokens(html);
    expect(out).toContain('<p>attachment:not-a-file</p>');
    expect(out).toContain('src="file:///data/attachments/a.png"');
    expect(out).toContain('href="file:///data/attachments/doc.pdf"');
  });

  it('无令牌时原样返回', () => {
    expect(resolveAttachmentTokens('<img src="data:image/png;base64,xx">')).toBe('<img src="data:image/png;base64,xx">');
  });
});
