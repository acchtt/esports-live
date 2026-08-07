import './styles.css';
import './compact-scoreboard.css';
import './compact-header.css';
import { startWebV2 } from './app.ts';
import { installChampionPortraitAssets } from './champion-portrait-assets.ts';
import { installCompactHeader } from './compact-header.ts';
import { installTeamSideIdentity } from './team-side-identity.ts';
import { installWinnerDeclaration } from './winner-declaration.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root.');

startWebV2(root);
installChampionPortraitAssets(root);
installTeamSideIdentity(root);
installWinnerDeclaration(root);
installCompactHeader(root);
