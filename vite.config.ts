import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    root: 'src/app',
    publicDir: '../../public',
    build: {
        outDir: '../../dist',
        emptyOutDir: true
    },
    server: {
        port: 5173
    },
    plugins: [tsconfigPaths()],
});
