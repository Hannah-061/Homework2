import type { DetailedHTMLProps, HTMLAttributes } from 'react';

// 讓 TypeScript 認得 <emoji-picker> 這個網頁標準元件
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'emoji-picker': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        locale?: string;
        'data-source'?: string;
      };
    }
  }
}
