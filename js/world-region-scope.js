/* Stable internal keys for voluntary administrative-region sharing.
   Named legacy geometry (GB:England) gets a country-scoped Z-key.
   Unnamed map slivers (AE-~0) are intentionally not selectable. */
(function(root){'use strict';function code(country,key){
 if(typeof country!=='string'||!/^[A-Z]{2}$/.test(country)||
    typeof key!=='string'||key.length>160||!key.startsWith(country))return null;
 if(new RegExp('^'+country+'-[A-Z0-9]{1,8}$').test(key))return key;
 if(key.startsWith(country+'-~')||(!key.startsWith(country+':')&&!key.startsWith(country+'-')))return null;
 if(!key.slice(3).trim()||/[<>]/.test(key))return null;
 var hash=2166136261;
 for(var i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619)>>>0;
 return country+'-Z'+hash.toString(36).toUpperCase().padStart(7,'0');
}root.MCC_WORLD_REGION_SCOPE=Object.freeze({code:code});})(window);
