// Browser-only host facade. Production always imports Obsidian's real API.
export class App {}
type Options = { text?: string; cls?: string; attr?: Record<string, string> };
function create<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, options: Options = {}): HTMLElementTagNameMap[K] {
  const child = document.createElement(tag);
  if (options.text) child.textContent = options.text;
  if (options.cls) child.className = options.cls;
  for (const [key, value] of Object.entries(options.attr ?? {})) child.setAttribute(key, value);
  parent.append(child); return child;
}
Object.assign(HTMLElement.prototype, {
  createEl(this: HTMLElement, tag: keyof HTMLElementTagNameMap, options: Options) { return create(this, tag, options); },
  createDiv(this: HTMLElement, options: Options) { return create(this, 'div', options); },
  setText(this: HTMLElement, text: string) { this.textContent = text; },
  addClass(this: HTMLElement, name: string) { this.classList.add(name); },
  empty(this: HTMLElement) { this.replaceChildren(); },
});
export class Modal {
  containerEl = document.createElement('div');
  titleEl = create(this.containerEl, 'h2');
  contentEl = create(this.containerEl, 'div');
  constructor(readonly app: App) { this.containerEl.className = 'modal'; }
  onOpen() {}
  onClose() {}
  open() { document.body.append(this.containerEl); this.onOpen(); }
  close() { this.onClose(); this.containerEl.remove(); }
}
export class Notice {
  constructor(message: string) { create(document.querySelector('#notices') as HTMLElement, 'p', { text: message }); }
}
export class Setting {
  el: HTMLElement;
  constructor(parent: HTMLElement) { this.el = create(parent, 'label'); }
  setName(name: string) { create(this.el, 'span', { text: name }); return this; }
  addToggle(callback: (control: { onChange(fn: (v: boolean) => void): void }) => void) {
    const input = create(this.el, 'input'); input.type = 'checkbox';
    callback({ onChange(fn) { input.addEventListener('change', () => fn(input.checked)); } }); return this;
  }
}
