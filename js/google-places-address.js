/* Google Places selection gate. Requires a browser-restricted Google Maps API key
   in window.MCC_GOOGLE_MAPS_BROWSER_KEY, configured by deployment. Never treats
   user metadata as authoritative server-side address verification. */
(function(){'use strict';
var field=document.getElementById('acCreateAddr1'),status=document.getElementById('acPlacesStatus');if(!field)return;
var selected=null;
function reset(){selected=null;if(status)status.textContent='Select an address from Google Places. Manual entries are not accepted.';}
['input','change'].forEach(function(event){field.addEventListener(event,reset)});
['acCreateCity','acCreateRegion','acCreatePostal','acCreateCountry'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',reset)});
window.MCC_VERIFIED_ADDRESS={isSelected:function(){return !!selected&&field.value===selected.address;},placeId:function(){return selected?selected.id:null;}};
var key=window.MCC_GOOGLE_MAPS_BROWSER_KEY;
if(!key){if(status)status.textContent='Google address verification is not configured yet. Signup is temporarily unavailable.';return;}
function init(){if(!window.google||!google.maps||!google.maps.places){if(status)status.textContent='Google Places could not load. Please retry later.';return;}
var autocomplete=new google.maps.places.Autocomplete(field,{types:['address'],fields:['place_id','formatted_address','address_components','geometry']});
autocomplete.addListener('place_changed',function(){var place=autocomplete.getPlace();reset();if(!place||!place.place_id||!place.formatted_address||!place.geometry){if(status)status.textContent='Select a complete address from the suggestions.';return;}
var components=place.address_components||[];function part(type){var c=components.find(function(x){return x.types.includes(type)});return c?(type==='country'||type==='administrative_area_level_1'?c.short_name:c.long_name):'';}
var number=part('street_number'),route=part('route'),city=part('locality')||part('postal_town'),region=part('administrative_area_level_1'),postal=part('postal_code'),country=part('country');
if(!number||!route||!city||!region||!postal||!country){if(status)status.textContent='Google did not return a complete street address. Correct it and select another suggestion.';return;}
field.value=number+' '+route;[['acCreateCity',city],['acCreateRegion',region],['acCreatePostal',postal],['acCreateCountry',country]].forEach(function(x){var el=document.getElementById(x[0]);if(el)el.value=x[1]});
selected={id:place.place_id,address:field.value};if(status)status.textContent='Google Places address selected. Final verification is pending.';
});}
var script=document.createElement('script');script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&libraries=places&v=weekly';script.async=true;script.onload=init;script.onerror=function(){if(status)status.textContent='Google Places unavailable. Signup is blocked until address selection works.'};document.head.appendChild(script);
})();