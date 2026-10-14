import json,unittest
from pathlib import Path
import torch
from services.retrieval.colbert_encoder import Encoder,chunks,query_prefix,reference_parity
class ColbertChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        cls.config=json.loads(Path('services/retrieval/colbert-study-protocol.json').read_text())
        cls.enc=Encoder(cls.config)
    def test_core_matches_pinned_reference(self):
        result=reference_parity(self.enc)
        self.assertTrue(result['passed']);self.assertLess(result['max_score_error'],1e-5)
    def test_chunks_cover_late_evidence_without_retokenization_overflow(self):
        text=('α-catenin lowers risk; counter-hypothesis matters. '*120)+'LATE EVIDENCE'
        parts=chunks(text,self.enc.tok)
        self.assertGreater(len(parts),5);self.assertIn('LATE EVIDENCE',parts[-1]['text'])
        for p in parts:
            self.assertEqual(p['text'],text[p['start']:p['end']])
            self.assertLessEqual(len(self.enc.tok(p['text'],add_special_tokens=False).input_ids),160)
        offsets=self.enc.tok(text,add_special_tokens=False,return_offsets_mapping=True,verbose=False).offset_mapping
        self.assertTrue(all(any(p['start']<=a and b<=p['end'] for p in parts) for a,b in offsets))
    def test_identical_raw_query_prefix_fits_both_models(self):
        text='This treatment does not increase cardiovascular risk. '*30
        q=query_prefix(text,self.enc.tok,61)
        self.assertTrue(text.startswith(q));self.assertLessEqual(len(self.enc.tok(q,add_special_tokens=False).input_ids),61)
        ids,mask=self.enc.tensorize([q],True);self.assertEqual(ids.shape[1],64)
        self.assertLessEqual(len(self.enc.tok(q,'biomedical '*160).input_ids),256)
    def test_special_query_slots_and_document_punctuation(self):
        qids,_=self.enc.tensorize(['Risk?'],True)
        self.assertEqual(qids[0,1].item(),1);self.assertIn(self.enc.tok.mask_token_id,qids[0].tolist())
        _,ids=self.enc.encode(['Risk?'])
        self.assertEqual(ids[0][1],2);self.assertNotIn(self.enc.tok.encode('?',add_special_tokens=False)[0],ids[0])
if __name__=='__main__':unittest.main()
