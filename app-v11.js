(()=>{
  const splash=document.getElementById('openingSplash');
  if(!splash)return;

  const started=performance.now();
  const minimumDisplay=2300;
  const maximumWait=12000;

  function appIsReady(){
    const login=document.getElementById('loginScreen');
    const app=document.getElementById('app');
    return (login&&!login.classList.contains('hidden'))||(app&&!app.classList.contains('hidden'));
  }

  function dismissWhenReady(){
    const elapsed=performance.now()-started;
    if(elapsed<minimumDisplay||(!appIsReady()&&elapsed<maximumWait)){
      window.setTimeout(dismissWhenReady,120);
      return;
    }
    splash.classList.add('is-leaving');
    window.setTimeout(()=>splash.remove(),520);
  }

  if(document.readyState==='complete')dismissWhenReady();
  else window.addEventListener('load',dismissWhenReady,{once:true});
})();
