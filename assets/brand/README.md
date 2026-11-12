# Brand assets

| File           | Content                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `logo.webp`    | The logo: the mark above the name, on its dark background, 1254 × 1254 px.               |
| `app-icon.png` | The application icon at 256 × 256 px: the mark on a plate in the dark color of the logo. |

The logo is a letter A in a gradient from violet to blue, with an orbit around it and a four-pointed star, all with a glow, on a dark indigo background with arcs of light in two corners ([ADR 0049](../../docs/adr/0049-logo-and-colors-of-the-brand.md)). Its colors are the colors of the browser: the violet is the default accent and the blue the color of progress (see [design rules](../../docs/architecture/design-system.md#design-rules)). The gradient, the glow and the star stay in the logo and the application icon.

`node tools/brand/render-icon.ts` renders the application icon from `logo.webp`: `app/build/icon.png` at 1024 × 1024 px, from which electron-builder derives the Windows, macOS and Linux icons, and `app-icon.png` for the website. The plate follows the icon grids of the operating systems, and the logo fades into it towards its edges. Render both again after every change to the logo and commit them.
