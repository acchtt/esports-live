const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  html{
    scroll-padding-bottom:108px!important
  }

  body.mobile-demo-active{
    padding-bottom:calc(96px + env(safe-area-inset-bottom))!important
  }
}
`;
document.head.append(style);
document.documentElement.dataset.mobileBottomNavClearance = 'v29';

export {};
