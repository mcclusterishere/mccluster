/* Missing catalog controls, verified against official fal API docs 2026-11-01.
   Existing nonempty schemas always win. This adds no models/providers, prices,
   grants, or database writes. Only the simple scene controls are represented.
   https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/api
   https://fal.ai/models/fal-ai/flux-2-max/edit/api */
const inputs = {
  'fal-ai/kling-video/v3/standard/image-to-video': {
    type: 'object', required: ['prompt','start_image_url'], properties: {
      prompt: { type:'string' },
      start_image_url: { type:'string', title:'Starting image' },
      end_image_url: { type:'string', title:'Ending image (optional)' },
      duration: { type:'string', title:'Seconds', enum:Array.from({length:13},(_,i)=>String(i+3)), default:'5' },
      generate_audio: { type:'boolean', title:'Generate scene audio', default:true },
      negative_prompt: { type:'string', title:'Avoid in this scene' }
    }
  },
  'fal-ai/flux-2-max/edit': {
    type:'object', required:['prompt','image_urls'], properties: {
      prompt:{type:'string'}, image_urls:{type:'array',items:{type:'string'},title:'Reference images'},
      image_size:{type:'string',title:'Image size',enum:['auto','square_hd','square','portrait_4_3','portrait_16_9','landscape_4_3','landscape_16_9'],default:'auto'},
      seed:{type:'integer',title:'Repeatable seed (optional)'},
      output_format:{type:'string',enum:['jpeg','png'],title:'Image format',default:'jpeg'}
    }
  }
};
export function withAuthoringInputs(model) {
  if (!model || model.provider!=='fal' || !inputs[model.provider_model_id] || Object.keys(model.parameter_schema || {}).length) return model;
  return {...model,parameter_schema:structuredClone(inputs[model.provider_model_id]),authoring_schema_source:'fal-api-docs-2026-11-01'};
}
