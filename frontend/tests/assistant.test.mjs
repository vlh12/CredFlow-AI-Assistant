import test from 'node:test';
import assert from 'node:assert/strict';
import {roleAllowed,allowed} from '../../backend/web/server.mjs';
import {formFields} from '../js/ai-assistant/loan-assistant.js';
test('assistant routes are seller-only and do not expose arbitrary backend operations',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 for(const [method,path] of [['GET','/api/v1/seller/loan-drafts'],['POST','/api/v1/seller/loan-drafts'],['PATCH',`/api/v1/seller/loan-drafts/${id}`],['POST',`/api/v1/seller/loan-drafts/${id}/assistant/messages`],['POST',`/api/v1/seller/loan-drafts/${id}/submit`]]){
 assert(allowed('auth',method,path));assert(roleAllowed('SELLER','auth',method,path));for(const role of ['ADMIN','MARKETPLACE','LENDER_OFFICER'])assert(!roleAllowed(role,'auth',method,path));
 }
 assert(!allowed('auth','DELETE',`/api/v1/seller/loan-drafts/${id}`));assert(!allowed('auth','POST',`/api/v1/seller/loan-drafts/${id}/approve`));
});
test('empty financial fields stay empty rather than becoming invented zero values',()=>{
 const values={requestedAmount:'50000',monthlyExpenses:'',existingMonthlyDebt:'0'};const form={elements:{namedItem:key=>({value:values[key]??''})}};
 const fields=formFields(form);assert.equal(fields.requestedAmount,'50000.00');assert.equal(fields.monthlyExpenses,'');assert.equal(fields.existingMonthlyDebt,'0.00');assert(!('initialSharingAuthorised' in fields));
});
