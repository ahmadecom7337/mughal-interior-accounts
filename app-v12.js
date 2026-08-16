(()=>{
  const image=document.getElementById('openingCarpenter');
  if(!image)return;

  const source=image.dataset.gifBase64;
  fetch(source,{cache:'force-cache'})
    .then(response=>{
      if(!response.ok)throw new Error('Animation could not be loaded.');
      return response.text();
    })
    .then(encoded=>{
      const binary=atob(encoded.trim());
      const bytes=new Uint8Array(binary.length);
      for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);
      const objectUrl=URL.createObjectURL(new Blob([bytes],{type:'image/gif'}));
      image.addEventListener('load',()=>image.classList.add('ready'),{once:true});
      image.src=objectUrl;
    })
    .catch(()=>{
      image.addEventListener('load',()=>image.classList.add('ready'),{once:true});
      image.src='Carpenter_hammering_nail.gif';
    });
})();
