import copy,json,os,threading,unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock,patch
import server
from automatic_seo_host import OzonSeoHost

SCHEMA={'type':'object','properties':{'title':{'type':'string'}},'required':['title'],'additionalProperties':False}
MESSAGES=[{'role':'system','content':'Return JSON'},{'role':'user','content':'Public product facts'}]

class OpenAIAdapterTest(unittest.TestCase):
 def setUp(self):
  self.patches=[patch.object(server,'OPTICARDS_LLM_PROVIDER','openai'),patch.object(server,'OPTICARDS_LLM_API_KEY','test-fixture-key'),patch.object(server,'OPTICARDS_LLM_API_BASE','https://api.openai.com/v1'),patch.object(server,'OPTICARDS_LLM_PROXY_URL',''),patch.object(server,'OPTICARDS_LLM_MODEL','gpt-6.1-terra'),patch.object(server,'OPTICARDS_LLM_CLASSIFIER_MODEL','gpt-6-luna'),patch.object(server,'OPTICARDS_LLM_REASONING_EFFORT','none'),patch.object(server,'OPTICARDS_LLM_CLASSIFIER_REASONING_EFFORT','low')]
  for p in self.patches:p.start()
  self.response=MagicMock();self.response.__enter__.return_value.read.return_value=b'{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}'
  self.transport=patch.object(server.urlrequest,'urlopen',return_value=self.response);self.request=self.transport.start()
 def tearDown(self):
  self.transport.stop()
  for p in reversed(self.patches):p.stop()
 def body(self):return json.loads(self.request.call_args.args[0].data)
 def test_modern_strict_schema_budget_and_timeout(self):
  messages=copy.deepcopy(MESSAGES)
  _,model,provider=server._audit_llm_chat_completion(messages,response_schema=SCHEMA,max_output_tokens=8192)
  body=self.body();self.assertEqual((model,provider),('gpt-6.1-terra','openai'));self.assertEqual(body['max_completion_tokens'],8192);self.assertNotIn('max_tokens',body);self.assertEqual(body['reasoning_effort'],'none');self.assertEqual(body['temperature'],.2)
  self.assertEqual(body['response_format']['json_schema']['schema'],SCHEMA);self.assertTrue(body['response_format']['json_schema']['strict']);self.assertEqual(self.request.call_args.kwargs['timeout'],120);self.assertEqual(messages,MESSAGES)
  self.assertIs(body['store'],False)
 def test_low_reasoning_omits_temperature_and_model_override_is_local(self):
  _,model,_=server._audit_llm_chat_completion(MESSAGES,model_override='gpt-6-luna',reasoning_effort='low');self.assertEqual(model,'gpt-6-luna');self.assertNotIn('temperature',self.body());self.assertEqual(self.body()['reasoning_effort'],'low');self.assertEqual(server.OPTICARDS_LLM_MODEL,'gpt-6.1-terra')
 def test_flagship_none_is_normalized_to_supported_low(self):
  server._audit_llm_chat_completion(MESSAGES,model_override='gpt-6.1-sol');self.assertEqual(self.body()['reasoning_effort'],'low');self.assertNotIn('temperature',self.body())
 def test_plain_text_does_not_request_json(self):
  server._audit_llm_chat_completion(MESSAGES,plain_text=True,max_output_tokens=4096);self.assertNotIn('response_format',self.body());self.assertEqual(self.request.call_args.kwargs['timeout'],60)
 def test_gpt4_compatible_path_keeps_legacy_budget(self):
  server._audit_llm_chat_completion(MESSAGES,max_output_tokens=2048,model_override='gpt-4o-mini');self.assertEqual(self.body()['max_tokens'],2048);self.assertNotIn('reasoning_effort',self.body());self.assertIn('temperature',self.body())
 def test_missing_key_never_calls_provider(self):
  with patch.object(server,'OPTICARDS_LLM_API_KEY',''):
   self.assertEqual(server._audit_llm_chat_completion(MESSAGES),(None,'','openai'))
  self.request.assert_not_called()
 def test_reoptimization_routes_to_openai_when_default_provider_is_gigachat(self):
  with patch.object(server,'OPTICARDS_LLM_PROVIDER','gigachat'), patch.object(server,'gigachat_access_token') as gigachat:
   _,model,provider=server.content_reoptimization_completion(MESSAGES)
   self.assertEqual((model,provider),('gpt-6.1-terra','openai'))
   self.assertIs(self.body()['store'],False)
   with patch.object(server,'OPTICARDS_LLM_API_KEY',''), patch.object(server,'GIGACHAT_AUTH_KEY','fixture'):
    self.assertFalse(server.content_reoptimization_configured('openai'))
    self.assertEqual(server.content_reoptimization_completion(MESSAGES),(None,'','openai'))
   gigachat.assert_not_called()
  self.request.assert_called_once()
 def test_classifier_routes_separately_in_automatic_and_durable_workflows(self):
  with patch.object(server,'audit_llm_chat_completion',return_value=({},'fake','openai')) as model:
   OzonSeoHost(server).automatic_seo_classify_completion(MESSAGES,SCHEMA)
   self.assertEqual(model.call_args.kwargs['model_override'],'gpt-6-luna');self.assertEqual(model.call_args.kwargs['reasoning_effort'],'low')
  self.assertIn('gpt-6-luna:low',server.semantic_model_key())
  with patch.object(server,'OPTICARDS_LLM_CLASSIFIER_MODEL','gpt-6.1-terra'):
   self.assertIn('gpt-6.1-terra:low',server.semantic_model_key())
 def test_parallel_requests_do_not_change_each_others_model(self):
  def generate(model):return server._audit_llm_chat_completion(MESSAGES,model_override=model)[1]
  with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(list(pool.map(generate,['gpt-6-luna','gpt-6.1-terra'])),['gpt-6-luna','gpt-6.1-terra'])
 def test_invalid_reasoning_configuration_fails_before_network(self):
  with self.assertRaisesRegex(ValueError,'llm_invalid_reasoning_effort'):
   server._audit_llm_chat_completion(MESSAGES,reasoning_effort='unbounded')
  self.request.assert_not_called()
 def test_response_size_is_bounded(self):
  self.response.__enter__.return_value.read.return_value=b'x'*(4*1024*1024+1)
  with self.assertRaisesRegex(ValueError,'llm_response_too_large'):server._audit_llm_chat_completion(MESSAGES)


class OpenAIProxyTest(unittest.TestCase):
 def test_explicit_proxy_ignores_environment_and_preserves_tls(self):
  captured={}
  class Connection:
   debuglevel=0
   _http_vsn=11
   def __init__(self,host,**kwargs):captured.update(host=host,**kwargs)
   def set_debuglevel(self,level):pass
   def set_tunnel(self,host,**kwargs):captured['tunnel']=host
   def request(self,method,path,body,headers,**kwargs):captured.update(method=method,path=path,headers=headers)
   def getresponse(self):raise server.urlerror.URLError('fixture proxy unavailable')
   def close(self):pass
  request=server.urlrequest.Request('https://api.openai.com/v1/chat/completions',data=b'{}')
  with patch.object(server,'OPTICARDS_LLM_PROXY_URL','http://127.0.0.1:24194'), \
       patch.dict(os.environ,{'NO_PROXY':'*','no_proxy':'*','HTTPS_PROXY':'http://wrong:9999'}), \
       patch.object(server.http.client,'HTTPSConnection',Connection), \
       patch.object(server.urlrequest,'urlopen',side_effect=AssertionError('direct fallback')):
   with self.assertRaises(server.urlerror.URLError):server.openai_urlopen(request,timeout=17)
  self.assertEqual(captured['host'],'127.0.0.1:24194')
  self.assertEqual(captured['tunnel'],'api.openai.com')
  self.assertEqual(captured['timeout'],17)
  self.assertTrue(captured['context'].check_hostname)
  self.assertEqual(captured['context'].verify_mode,server.ssl.CERT_REQUIRED)
  self.assertEqual(captured['method'],'POST')
  self.assertEqual(captured['path'],'/v1/chat/completions')
  self.assertNotIn('Proxy-Authorization',captured['headers'])
 def test_invalid_configuration_fails_before_network_without_echoing_secret(self):
  for proxy in ('https://127.0.0.1:24194','http://user:secret@127.0.0.1:24194','http://127.0.0.1:bad','http://127.0.0.1:24194/path','http://['):
   with self.subTest(proxy=proxy),patch.object(server,'OPTICARDS_LLM_PROXY_URL',proxy), \
        patch.object(server.urlrequest,'build_opener') as build:
    with self.assertRaisesRegex(ValueError,'^llm_invalid_proxy_url$'):
     server.openai_urlopen(server.urlrequest.Request('https://api.openai.com/v1'),timeout=17)
    build.assert_not_called()
 def test_proxy_rejects_plain_http_api_before_network(self):
  with patch.object(server,'OPTICARDS_LLM_PROXY_URL','http://127.0.0.1:24194'):
   with self.assertRaisesRegex(ValueError,'llm_proxy_requires_https'):
    server.openai_urlopen(server.urlrequest.Request('http://api.openai.com/v1'),timeout=17)
 def test_redirect_cannot_forward_credentials_or_escape_proxy(self):
  request=server.urlrequest.Request('https://api.openai.com/v1',headers={'Authorization':'Bearer test-fixture'})
  with self.assertRaises(server.urlerror.HTTPError) as error:
   server.OpenAINoRedirectHandler().redirect_request(request,None,302,'Found',{},'http://other.example/')
  self.assertEqual(error.exception.code,302)
  self.assertEqual(error.exception.reason,'llm_redirect_disallowed')
