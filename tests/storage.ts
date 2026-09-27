import type { Storage } from '../src/history/history-manager';
export class MemoryStorage implements Storage {
  files = new Map<string, string>();
  fail = false;
  async exists() { return true; }
  async mkdir() {}
  async write(path: string, data: string) { if (this.fail) throw new Error('disk full'); this.files.set(path, data); }
  async read(path: string) { return this.files.get(path)!; }
  async list() { return { files: [...this.files.keys()] }; }
  async remove(path: string) { this.files.delete(path); }
}
