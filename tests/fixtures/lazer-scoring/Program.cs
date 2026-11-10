using System.Text.Json;
using osu.Game.Beatmaps;
using osu.Game.Rulesets.Mania.Objects;
using osu.Game.Rulesets.Mania.Scoring;
using osu.Game.Rulesets.Mania.Mods;
using osu.Game.Rulesets.Mania.Difficulty;
using osu.Game.Rulesets.Mania.Difficulty.Skills;
using osu.Game.Rulesets.Mania.Difficulty.Preprocessing;
using osu.Game.Rulesets.Difficulty.Preprocessing;
using osu.Game.Rulesets.Mods;
using osu.Game.Rulesets.Scoring;
using osu.Game.Rulesets.Judgements;
using osu.Game.Rulesets.Objects;
using osu.Game.Scoring;

var input=JsonDocument.Parse(Console.In.ReadToEnd()).RootElement;
var results=new Dictionary<string,object>();
HitResult[] basic=[HitResult.Perfect,HitResult.Great,HitResult.Good,HitResult.Ok,HitResult.Meh,HitResult.Miss];
string[] mods(JsonElement c)=>c.GetProperty("mods").EnumerateArray().Select(m=>m.GetString()!).ToArray();
List<HitObject> objects(JsonElement c)=>c.GetProperty("notes").EnumerateArray().Select(n=>{
    ManiaHitObject h=n.GetProperty("isLN").GetBoolean()?new HoldNote():new Note();
    h.StartTime=n.GetProperty("time").GetDouble();h.EndTime=n.GetProperty("end").GetDouble();h.Column=n.GetProperty("col").GetInt32();
    if(h is HoldNote){
        h.Judgement.MaxResult=HitResult.IgnoreHit;
        h.NestedHitObjects.Add(new HeadNote(){StartTime=h.StartTime,EndTime=h.StartTime});
        h.NestedHitObjects.Add(new TailNote(){StartTime=h.EndTime,EndTime=h.EndTime});
        h.NestedHitObjects.Add(new HoldNoteBody(){StartTime=h.StartTime,EndTime=h.EndTime,Judgement=new(){MaxResult=HitResult.IgnoreHit,MinResult=HitResult.ComboBreak}});
    }
    return (HitObject)h;
}).OrderBy(h=>h.StartTime).ToList();
Mod[] modObjects(string[] m,double rate=.75)=>m.Select<string,Mod>(id=>id switch {
    "EZ"=>new ManiaModEasy(),"NF"=>new ManiaModNoFail(),"HT"=>new ManiaModHalfTime(),"DC"=>new ManiaModDaycore(),"NR"=>new ManiaModNoRelease(),
    "DA"=>new ManiaModDifficultyAdjust(),"4K"=>new ManiaModKey4(),"RT"=>new ManiaModHalfTime(){SpeedChange={Value=rate}},_=>new Mod()
}).ToArray();
results["health"]=input.GetProperty("health").EnumerateArray().Select(c=>{
    var map=new Beatmap();map.HitObjects.AddRange(objects(c));
    var m=mods(c);float hp=(float)c.GetProperty("hp").GetDouble();
    if(m.Contains("EZ"))hp*=.5f;else if(m.Contains("HR"))hp=Math.Min(10,hp*1.4f);
    if(m.Contains("DA")&&c.TryGetProperty("hpOverride",out var over)&&over.ValueKind==JsonValueKind.Number)hp=(float)over.GetDouble();
    map.Difficulty.DrainRate=hp;
    foreach(var b in c.GetProperty("breaks").EnumerateArray())map.Breaks.Add(new(){StartTime=b.GetProperty("start").GetDouble(),EndTime=b.GetProperty("end").GetDouble()});
    var health=new AuditHealth(map.HitObjects.Count>0?map.HitObjects[0].StartTime:0);health.ApplyBeatmap(map);
    int lives=m.Contains("EZ")?2:0;
    health.Failed+=()=>{if(m.Contains("NF"))return false;if(lives>0){lives--;health.Health.Value=1;return false;}return true;};
    var perfect=new ManiaModPerfect(){RequirePerfectHits={Value=m.Contains("PSS")}};
    health.FailConditions+=(p,r)=>m.Contains("SD")&&r.Type.AffectsCombo()&&!r.IsHit||(m.Contains("PF")||m.Contains("PSS"))&&perfect.Check(p,r);
    var timeline=new List<object>();
    foreach(var e in c.GetProperty("events").EnumerateArray()){
        int j=e.GetProperty("j").GetInt32();HitObject obj=j<0?new HoldNoteBody(){Judgement=new(){MaxResult=HitResult.IgnoreHit,MinResult=HitResult.ComboBreak}}:e.GetProperty("hold").GetBoolean()?new HeadNote():new Note();
        health.ApplyResult(new(){HitObject=obj,Judgement=obj.Judgement,Type=j<0?HitResult.ComboBreak:basic[j],TimeAbsolute=e.GetProperty("t").GetDouble()});
        timeline.Add(new{value=health.Health.Value,failed=health.HasFailed,lives});
    }
    return new{id=c.GetProperty("id").GetString(),hp,multiplier=health.Multiplier,drain=health.DrainRate,timeline};
}).ToArray();
results["score"]=input.GetProperty("score").EnumerateArray().Select(c=>{
    var m=modObjects(mods(c),c.GetProperty("config").GetProperty("rate").GetDouble());
    double multiplier=new ManiaScoreMultiplierCalculator(new(new BeatmapDifficulty())).CalculateFor(m);
    var score=new ManiaScoreProcessor();score.Configure(c.GetProperty("total").GetInt32(),multiplier);
    var timeline=new List<object>();
    foreach(var j in c.GetProperty("sequence").EnumerateArray().Select(j=>j.GetInt32())){
        score.ApplyResult(new(){Type=j<0?HitResult.ComboBreak:basic[j],Judgement=new(){MaxResult=j<0?HitResult.IgnoreHit:HitResult.Perfect}});
        timeline.Add(new{accuracy=score.Accuracy.Value,score=score.TotalScore.Value,unmultiplied=score.TotalScoreWithoutMods.Value,combo=score.Combo.Value,maxCombo=score.HighestCombo.Value});
    }
    return new{id=c.GetProperty("id").GetString(),multiplier,timeline};
}).ToArray();
results["pp"]=input.GetProperty("pp").EnumerateArray().Select(c=>{
    var counts=c.GetProperty("counts").EnumerateArray().Select(x=>x.GetInt32()).ToArray();
    var score=new ScoreInfo(){Mods=modObjects(mods(c)),Statistics=basic.Select((j,i)=>(j,i)).ToDictionary(x=>x.j,x=>counts.ElementAtOrDefault(x.i))};
    var calc=new ManiaPerformanceCalculator();double pp=calc.Run(score,new ManiaDifficultyAttributes(){StarRating=c.GetProperty("stars").GetDouble()}).Total;
    double accuracy=(double)typeof(ManiaPerformanceCalculator).GetField("scoreAccuracy",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.GetValue(calc)!;
    return new{id=c.GetProperty("id").GetString(),pp,accuracy};
}).ToArray();
results["difficulty"]=input.GetProperty("difficulty").EnumerateArray().Select(c=>{
    var hs=objects(c).ToArray();double rate=c.GetProperty("rate").GetDouble();int keys=c.GetProperty("keys").GetInt32();
    osu.Game.Rulesets.Mania.MathUtils.LegacySortHelper<HitObject>.Sort(hs,Comparer<HitObject>.Create((a,b)=>(int)Math.Round(a.StartTime)-(int)Math.Round(b.StartTime)));
    var perColumn=Enumerable.Range(0,keys).Select(_=>new List<DifficultyHitObject>()).ToArray();var diff=new List<DifficultyHitObject>();
    for(int i=1;i<hs.Length;i++){var obj=new ManiaDifficultyHitObject(hs[i],hs[i-1],rate,diff,perColumn,diff.Count);diff.Add(obj);perColumn[obj.Column].Add(obj);}
    var strain=new Strain([],keys);foreach(var obj in diff)strain.Process(obj);
    double stars=strain.DifficultyValue()*.018;
    double pp=new ManiaPerformanceCalculator().Run(new ScoreInfo(){Statistics=new(){{HitResult.Perfect,hs.Sum(h=>h is HoldNote?2:1)}}},new ManiaDifficultyAttributes(){StarRating=stars}).Total;
    return new{id=c.GetProperty("id").GetString(),stars,pp};
}).ToArray();
Console.Write(JsonSerializer.Serialize(results));

class AuditHealth(double time):ManiaHealthProcessor(time){public double Multiplier=>HpMultiplierNormal;}
