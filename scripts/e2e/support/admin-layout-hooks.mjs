/* Test-only composition of the additive hooks reserved for the release owner. */
export function composeAdminLayout(path,source){
 if(path.endsWith('/control.html'))return source.replace('</head>','<link rel="stylesheet" href="css/control-admin-layout.css"><script defer src="js/control-room/section-groups.js"></script></head>');
 if(path.endsWith('/js/control-room-v2.js')){
  const anchor='    var views = it.views && it.views.length > 1 ?';
  if(!source.includes(anchor))throw Error('Section navigation integration anchor changed');
  return source.replace(anchor,'    if (window.CR.sectionGroups) tabs = window.CR.sectionGroups.render(entry) || tabs;\n'+anchor);
 }
 return source;
}
