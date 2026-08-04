const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
if (nav) nav.dataset.mobileNavVersion = '0.16';

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active [data-selection-snapshot-pending]{
    gap:12px;
    min-height:280px;
    padding:36px 24px!important;
    text-align:center
  }
  body.mobile-demo-active [data-selection-snapshot-pending] .analysis-empty-icon{
    color:#55c4ff
  }
  body.mobile-demo-active [data-selection-snapshot-pending] small{
    display:block;
    max-width:330px;
    color:#8290a5;
    font-size:.7rem;
    font-weight:700;
    line-height:1.45
  }
}`;
document.head.append(style);

export {};
