/* Release-owned shared hooks, composed only in browser fixtures. */
export function composeEditorPresentation(path,source){
 if(path.endsWith('/control.html'))return source.replace('</head>','<link rel="stylesheet" href="css/control-editor-presentation.css"><script defer src="js/control-room/editor-presentation.js"></script></head>');
 if(path.endsWith('/js/control-room-v2.js')){
  const anchor='    bindSurfaceControls();';
  if(!source.includes(anchor))throw Error('Editor presentation integration anchor changed');
  return source.replace(anchor,anchor+'\n    if (window.CR.editorPresentation) window.CR.editorPresentation.enhance(root, {route: state.route, scope: state.org && state.org.id});');
 }
 return source;
}
