import { TFile } from 'obsidian';
import { JotsSettings, Rule, RenderLocation } from '../types';

export class RuleProcessor {
    constructor(
        private settings: JotsSettings
    ) {}

    getApplicableRules(file: TFile): Rule[] {
        const rules = this.settings.rules || [];
        return rules.filter(rule => {
            if (!rule.enabled) return false;
            if (!rule.path) return false;
            
            const pattern = rule.path.toLowerCase();
            const filePath = file.path.toLowerCase();
            
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                try {
                    const regex = new RegExp(pattern.slice(1, -1));
                    return regex.test(filePath);
                } catch {
                    return false;
                }
            }
            
            return filePath.includes(pattern);
        });
    }

    getRuleContent(rule: Rule, position: 'header' | 'footer'): string {
        return position === 'header' 
            ? (rule.renderLocation === RenderLocation.Header ? rule.footerText || '' : '')
            : (rule.renderLocation === RenderLocation.Footer ? rule.footerText || '' : '');
    }
}
