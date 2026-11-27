/**
 * Themes: a coordinated look for a layout. Each is an original kit built on
 * genre conventions (not a copy of any published book): a body font, a heading
 * font, ink and heading colours, and a paper colour.
 *
 * Applying a theme restyles the layout's existing text and sets the defaults
 * for new text frames.
 */
export interface Theme {
  id: string;
  name: string;
  bodyFont: string;
  headingFont: string;
  /** Body text colour. */
  ink: string;
  headingColor: string;
  /** Page background. */
  paper: string;
  bodySize: number;
}

export const THEMES: Theme[] = [
  {
    id: 'plain',
    name: 'Plain',
    bodyFont: 'EB Garamond',
    headingFont: 'EB Garamond',
    ink: '#1a1a1a',
    headingColor: '#1a1a1a',
    paper: '#ffffff',
    bodySize: 11,
  },
  {
    id: 'grimoire',
    name: 'High fantasy',
    bodyFont: 'EB Garamond',
    headingFont: 'Cinzel',
    ink: '#2b2118',
    headingColor: '#7a1f1f',
    paper: '#f4ead5',
    bodySize: 11,
  },
  {
    id: 'dossier',
    name: 'Modern day',
    bodyFont: 'Source Serif 4',
    headingFont: 'Barlow Condensed',
    ink: '#16181d',
    headingColor: '#1f3a5f',
    paper: '#fbfbf8',
    bodySize: 10,
  },
];

export function getTheme(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
