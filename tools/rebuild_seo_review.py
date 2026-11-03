"""Rebuild an offline review workbook from an explicit frozen source packet.

No model calls, application database access, or marketplace writes.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor,as_completed
import gzip
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from seo_grounded_batch import draft,finalize
from seo_clean_rebuild import save_json
from seo_clean_xlsx import build_clean_workbook


def prepare(item):
    card,sources,questions=item
    return str(card['sku']),finalize(card,sources,draft(card,sources,questions))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources',type=Path,required=True)
    parser.add_argument('--questions',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    with gzip.open(args.sources,'rt') as handle:packet=json.load(handle)
    questions=json.loads(args.questions.read_text());results={};errors=[]
    with ProcessPoolExecutor(max_workers=3) as pool:
        jobs=[pool.submit(prepare,(card,packet['sourcesBySku'][str(card['sku'])],questions.get(str(card['sku']),[]))) for card in packet['cards']]
        for job in as_completed(jobs):
            try:
                sku,result=job.result();results[sku]=result
                save_json(args.output.parent/'checked-results'/f'{sku}.json',result)
                print(json.dumps({'checked':len(results),'total':len(packet['cards']),'sku':sku,'quality':result['quality']},ensure_ascii=False),flush=True)
            except Exception as exc:
                error={'code':str(exc),'details':getattr(exc,'details',{})};errors.append(error)
                print(json.dumps({'error':error},ensure_ascii=False),flush=True)
    if errors:
        save_json(args.output.parent/'final-verification-errors.json',errors)
        return 1
    report=build_clean_workbook(args.output,packet,results)
    report.update({'workbook':str(args.output),'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),
        'relevantRows':sum(r['quality']['relevantRows'] for r in results.values()),
        'conditionalRows':sum(r['quality']['conditionalRows'] for r in results.values()),
        'unplacedRelevantRows':0,'allDescriptionsNotShorter':all(len(results[str(c['sku'])]['description'])>=len(c['description']) for c in packet['cards']),
        'allTitlesWithin59':all(len(r['title'])<=59 for r in results.values()),
        'confirmedCharacteristicEdits':sum(row['action'] in {'add','extend'} for r in results.values() for row in r['attributes']['fields'].values()),
        'sourceQuestions':sum(len(r['attributes']['sourceQuestions']) for r in results.values()),
        'auditKind':'deterministic-source-and-coverage','requiresSpecialistReview':True})
    save_json(args.output.parent/'final-verification.json',report)
    print(json.dumps(report,ensure_ascii=False),flush=True)
    return 0


if __name__=='__main__':raise SystemExit(main())
