import './styles.css';
import { startWebV2 } from './app.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root.');

startWebV2(root);
