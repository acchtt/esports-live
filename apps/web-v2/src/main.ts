import './styles.css';
import './compact-scoreboard.css';
import { startWebV2 } from './app.ts';
import { installChampionPortraitAssets } from './champion-portrait-assets.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root.');

startWebV2(root);
installChampionPortraitAssets(root);
