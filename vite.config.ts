import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      plugins: [
        dts({
          rollupTypes: true,
          include: ['src/index.ts', 'src/gl/**/*', 'src/ui/**/*', 'src/capture/**/*'],
        }),
      ],
      build: {
        lib: {
          entry: resolve(process.cwd(), 'src/index.ts'),
          name: 'ThemeChanger',
          fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
          formats: ['es', 'cjs'],
        },
        rollupOptions: {
          // Do not bundle html2canvas and gsap inside the library bundle; consumers import them
          external: ['gsap', 'html2canvas'],
          output: {
            globals: {
              gsap: 'gsap',
              html2canvas: 'html2canvas',
            },
          },
        },
        outDir: 'dist',
        emptyOutDir: false,
      },
    };
  }

  return {
    build: {
      outDir: 'dist',
    },
  };
});
