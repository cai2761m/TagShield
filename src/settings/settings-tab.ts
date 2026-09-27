import { PluginSettingTab, Setting } from 'obsidian';
import type TagShieldPlugin from '../main';
import type { Settings } from '../types';
export class TagShieldSettingTab extends PluginSettingTab {
  constructor(private plugin: TagShieldPlugin) { super(plugin.app, plugin); }
  display() {
    const { containerEl: el } = this;
    el.empty();
    el.createEl('h2', { text: 'TagShield' });
    new Setting(el).setName('保护模式').setDesc('默认只提示。自动模式仅处理 literal 标记的下一行，并且仍遵守全部语法保护。')
      .addDropdown(control => control.addOptions({ safe: '安全 / 询问', automatic: '自动保护', manual: '仅手动命令' })
        .setValue(this.plugin.settings.mode).onChange(value => this.change({ mode: value as Settings['mode'] })));
    new Setting(el).setName('转义方式').addDropdown(control => control.addOptions({ backslash: '\\<body\\>', code: '`<body>`', entity: '&lt;body&gt;' })
      .setValue(this.plugin.settings.escapeStyle).onChange(value => this.change({ escapeStyle: value as Settings['escapeStyle'] })));
    new Setting(el).setName('自动保护最低置信度').setDesc('0.95–1.00；降低阈值不会取消明确文字标记的要求。')
      .addSlider(control => control.setLimits(0.95, 1, 0.01).setValue(this.plugin.settings.autoThreshold).setDynamicTooltip()
        .onChange(value => this.change({ autoThreshold: value })));
    new Setting(el).setName('始终忽略的标签').setDesc('逗号分隔，不含尖括号。')
      .addText(control => control.setValue(this.plugin.settings.ignoredTags.join(', ')).onChange(value =>
        this.change({ ignoredTags: value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) })));
    new Setting(el).setName('历史保留天数').setDesc('1–365 天，默认 30。').addText(control => control.setValue(String(this.plugin.settings.retentionDays))
      .onChange(value => this.changeNumber('retentionDays', value, 365)));
    new Setting(el).setName('历史保留操作数').setDesc('1–1000 次，默认 100。完整快照可能包含敏感笔记内容。')
      .addText(control => control.setValue(String(this.plugin.settings.retentionCount)).onChange(value => this.changeNumber('retentionCount', value, 1000)));
    for (const name of ['保护代码块与行内代码', '保护 YAML Frontmatter', '保护真实 HTML 和 HTML 块', '修改前保存可回滚历史']) {
      new Setting(el).setName(name).setDesc('安全保障，始终开启。').addToggle(control => control.setValue(true).setDisabled(true));
    }
    el.createEl('p', { text: '区域保留：<!-- tagshield: off --> … <!-- tagshield: on -->。忽略下一非空行：<!-- tagshield: ignore-next -->。关闭笔记自动提示：Frontmatter 中设置 tagshield: false。' });
  }
  private async change(values: Partial<Settings>) { Object.assign(this.plugin.settings, values); await this.plugin.saveSettings(); }
  private async changeNumber(key: 'retentionDays' | 'retentionCount', text: string, max: number) {
    const value = Number(text);
    if (Number.isInteger(value) && value >= 1 && value <= max) await this.change({ [key]: value });
  }
}
