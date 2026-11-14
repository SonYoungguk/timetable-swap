import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 어느 경로 아래에 올려도(예: GitHub Pages 의 /저장소이름/) 열리도록 상대 경로로 빌드한다.
  base: './',
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
