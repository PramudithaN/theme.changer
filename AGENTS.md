# Project Workflow & Release Guidelines: @pramuditha/theme.changer

## Package Information
- **Package Name**: `@pramuditha/theme.changer`
- **Scope**: Scoped public package under `@pramuditha`
- **Registry**: https://www.npmjs.com/package/@pramuditha/theme.changer

## Development & Build Workflow
Whenever making code changes in this repository:
1. **Always rebuild and test**:
   - Run `npm run build` to verify that both the demo (`docs/`) and library outputs (`dist/`) build without errors.
2. **Preserve distribution structure**:
   - Keep `"files": ["dist"]` in `package.json` so all nested TypeScript type declarations (`dist/gl/`, `dist/capture/`, `dist/ui/`) are properly packaged.
   - External dependencies `gsap` and `html2canvas` must remain external in `vite.config.ts`.
3. **Keep documentation and examples synced**:
   - Any API or preset changes should be reflected in `README.md` and `src/index.ts`.

## Publishing / Release Workflow
Whenever publishing an update:
1. **Bump the version** in `package.json` (e.g. `1.0.1` -> `1.0.2` for patch/bugfix, `1.1.0` for features).
2. **Run `npm run build`** (or let `prepublishOnly` run it).
3. **Publish with public access**:
   ```bash
   npm publish --access=public
   ```
   *(Note: 2FA is enabled on `@pramuditha`, so supply the 6-digit OTP code when prompted).*
