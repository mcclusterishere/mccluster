/* An ordinary owned front-page layout; no name, slug or brand grants authority. */
(function(w,d){'use strict';
 function node(tag,text,cls){var n=d.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
 function href(value){return typeof value==='string'&&value.length<=300&&(/^https:\/\/[^\s"'<>]+$/i.test(value)||/^(?![a-z][a-z0-9+.-]*:)(?!\/\/)[a-z0-9_./?#=&%-]+$/i.test(value))?value:null;}
 function link(value){if(!value||!href(value.href))return null;var a=node('a',value.label,'so-button');a.href=value.href;return a;}
 function defaults(name){return {title:name||'Your work, in one place',intro:'Introduce what you do and how people can take part.',cards:[{title:'What I offer',body:'Describe your work, who it is for, and the next step.'}]};}
 function render(page,host){
  var p=page.config.offer_page||{},root=host||node('main',null,'site-offers');root.classList.add('site-offers');root.replaceChildren();
  var hero=node('header',null,'so-hero');hero.append(node('p',page.name||page.handle,'so-name'),node('h1',p.title||page.name),node('p',p.intro,'so-intro'));
  var buttons=node('div',null,'so-actions');[p.primary,p.secondary].forEach(function(x){var a=link(x);if(a)buttons.append(a);});hero.append(buttons);root.append(hero);
  var grid=node('div',null,'so-grid');(p.cards||[]).slice(0,6).forEach(function(card){var section=node('section',null,'so-card');
   if(card.image&&/^https:\/\//.test(card.image)){var image=node('img');image.src=card.image;image.alt='';image.loading='lazy';section.append(image);}
   if(card.status)section.append(node('p',card.status,'so-status'));section.append(node('h2',card.title),node('p',card.body));if(card.experiences){var list=node('ol',null,'so-experiences');card.experiences.slice(0,3).forEach(function(item){var li=node('li');li.append(node('strong',item.title+'. '),d.createTextNode(item.body||''));list.append(li);});section.append(list);}var a=link(card.action);if(a)section.append(a);grid.append(section);
  });root.append(grid);var manage=node('a','Manage this website','so-manage');manage.href='https://matthew.mccluster.org/'+(page.slug?'project-studio.html?project='+encodeURIComponent(page.slug):'front-studio.html');root.append(manage);return root;
 }
 w.MCC_SITE_OFFERS={defaults:defaults,render:render};
})(window,document);
