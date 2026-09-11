import { currentPage } from '@weasel-js/labkit';
import { describe, expect, it } from 'vitest';
import { LABS, type LabId, labHref, labPages } from '../../../dev/shared/pages.js';

const LAN = { protocol: 'http:', hostname: '10.0.0.187' };
const IPV6 = { protocol: 'http:', hostname: '[::1]' };

describe('dev lab pages', () => {
  it('links each lab on the host the page was opened on, at that lab port', () => {
    expect(labPages(LAN)).toEqual([
      { href: 'http://10.0.0.187:5181', label: 'tube lab' },
      { href: 'http://10.0.0.187:5182', label: 'kliegsminister' },
      { href: 'http://10.0.0.187:5184', label: 'composition lab' },
    ]);
    expect(labHref('kliegsminister', IPV6)).toBe('http://[::1]:5182');
  });

  it("marks the lab whose own address is passed as the switcher's path", () => {
    const ids = Object.keys(LABS) as LabId[];
    for (const origin of [LAN, IPV6]) {
      const pages = labPages(origin);
      ids.forEach((id, i) => {
        expect(currentPage(labHref(id, origin), pages)).toBe(i);
      });
    }
  });
});
