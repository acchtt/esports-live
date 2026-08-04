const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active[data-mobile-context="history"] .mobile-app-nav{
    right:0!important;
    left:0!important;
    bottom:0!important;
    width:100vw!important;
    max-width:none!important;
    border-right:0!important;
    border-bottom:0!important;
    border-left:0!important;
    border-radius:0!important
  }
}
`;
document.head.append(style);

export {};
