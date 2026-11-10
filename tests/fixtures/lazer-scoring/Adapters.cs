// Test-only framework/beatmap adapters. Arithmetic marked below is inserted verbatim from pinned upstream.
using osu.Game.Beatmaps;
using osu.Game.Rulesets.Judgements;
using osu.Game.Rulesets.Objects;
using osu.Game.Rulesets.Scoring;
using osu.Game.Rulesets.Mods;
using osu.Game.Scoring;

namespace osu.Framework.Extensions.EnumExtensions {
    public class HasOrderedElementsAttribute : Attribute {}
    public class OrderAttribute(int order) : Attribute {}
    public static class EnumExtensions { public static IEnumerable<T> GetValuesInOrder<T>() where T : struct, Enum => Enum.GetValues<T>(); }
}
namespace osu.Framework.Utils {
    public static class Precision {
        public static bool AlmostBigger(double a,double b,double acceptableDifference=1e-7) => a > b-acceptableDifference;
        public static bool DefinitelyBigger(double a,double b,double acceptableDifference=1e-7) => a-acceptableDifference > b;
    }
}
namespace osu.Framework.Bindables {
    public class Bindable<T>(T value=default!) { public T Value {get;set;}=value; }
    public class BindableBool : Bindable<bool> {}
    public class BindableDouble(double value=0) {
        public double MinValue {get;set;}=double.MinValue; public double MaxValue {get;set;}=double.MaxValue;
        private double value=value; public double Value {get=>value;set=>this.value=Math.Clamp(value,MinValue,MaxValue);}
    }
}
namespace osu.Game.Configuration { public class SettingSourceAttribute(string name) : Attribute {} }
namespace osu.Game.Beatmaps {
    public interface IBeatmapDifficultyInfo {
        static double DifficultyRange(double difficulty,double min,double mid,double max) => difficulty>5 ? mid+(max-mid)*((difficulty-5)/5) : difficulty<5 ? mid+(mid-min)*((difficulty-5)/5) : mid;
    }
    public class BeatmapDifficulty : IBeatmapDifficultyInfo { public float DrainRate {get;set;}=5; }
    public class BreakPeriod {public double StartTime {get;set;} public double EndTime {get;set;} }
    public interface IBeatmap {List<HitObject> HitObjects {get;} List<BreakPeriod> Breaks {get;} BeatmapDifficulty Difficulty {get;} }
    public class Beatmap : IBeatmap {public List<HitObject> HitObjects {get;}=[]; public List<BreakPeriod> Breaks {get;}=[]; public BeatmapDifficulty Difficulty {get;}=new();}
}
namespace osu.Game.Rulesets.Objects {
    public class HitObject {
        public double StartTime {get;set;} public double EndTime {get;set;}
        public List<HitObject> NestedHitObjects {get;}=[];
        public Judgement Judgement {get;set;}=new(); public HitWindows HitWindows {get;set;}=new();
    }
    public static class HitObjectExtensions { public static double GetEndTime(this HitObject obj)=>obj.EndTime; }
}
namespace osu.Game.Rulesets.Mania.Objects {
    public class ManiaHitObject : HitObject { public int Column {get;set;} }
    public class Note : ManiaHitObject {}
    public class HeadNote : Note {}
    public class TailNote : Note {}
    public class HoldNoteBody : ManiaHitObject {}
    public class HoldNote : ManiaHitObject {}
}
namespace osu.Game.Rulesets.Judgements {
    public class Judgement { public HitResult MaxResult {get;set;}=HitResult.Perfect; public HitResult MinResult {get;set;}=HitResult.Miss; }
    public class JudgementResult {
        public HitObject HitObject {get;set;}=new(); public Judgement Judgement {get;set;}=new(); public HitResult Type {get;set;}
        public bool FailedAtJudgement; public double HealthAtJudgement,HealthIncrease,TimeAbsolute;
        public int ComboAtJudgement,HighestComboAtJudgement,ComboAfterJudgement,HighestComboAfterJudgement;
        public bool IsHit=>Type.IsHit();
    }
}
namespace osu.Game.Scoring {
    public enum ScoreRank {X,S,A,B,C,D}
    public record HealthValue(double Time,double Value);
    public class ScoreInfo {
        public Dictionary<HitResult,int> Statistics {get;set;}=[]; public Mod[] Mods {get;set;}=[];
        public List<HealthValue> HealthGraph {get;set;}=[]; public int TotalScoreVersion {get;set;}=30000017;
        public string ClientVersion {get;set;}="2026.1110.0"; public DateTimeOffset Date {get;set;}=DateTimeOffset.UtcNow;
    }
}
namespace osu.Game.Rulesets.Mania { public class ManiaRuleset {} }
namespace osu.Game.Rulesets.Mods {
    public class Mod {}
    public class ModNoFail : Mod {} public class ModEasy : Mod {}
    public class ModPerfect : Mod {
        protected virtual bool FailCondition(HealthProcessor h,JudgementResult r)=>false;
        public bool Check(HealthProcessor h,JudgementResult r)=>FailCondition(h,r);
    }
    public class ModWindUp : Mod {} public class ModWindDown : Mod {} public class ModAdaptiveSpeed : Mod {}
}
namespace osu.Game.Rulesets.Mania.Mods {
    public class ManiaModEasy : ModEasy {} public class ManiaModNoFail : ModNoFail {}
    public class ManiaModHalfTime : Mod { public osu.Framework.Bindables.Bindable<double> SpeedChange {get;}=new(.75); }
    public class ManiaModDaycore : Mod { public osu.Framework.Bindables.Bindable<double> SpeedChange {get;}=new(.75); }
    public class ManiaModNoRelease : Mod {} public class ManiaModDifficultyAdjust : Mod {} public class ManiaModClassic : Mod {}
    public class ManiaModConstantSpeed : Mod {} public class ManiaModHoldOff : Mod {}
    public class ManiaModKey1 : Mod {} public class ManiaModKey2 : Mod {} public class ManiaModKey3 : Mod {} public class ManiaModKey4 : Mod {} public class ManiaModKey5 : Mod {}
    public class ManiaModKey6 : Mod {} public class ManiaModKey7 : Mod {} public class ManiaModKey8 : Mod {} public class ManiaModKey9 : Mod {} public class ManiaModKey10 : Mod {}
}
namespace osu.Game.Rulesets.Difficulty {
    public class DifficultyAttributes { public double StarRating {get;set;} }
    public class PerformanceAttributes { public double Total {get;set;} }
    public abstract class PerformanceCalculator(object ruleset) {
        protected abstract PerformanceAttributes CreatePerformanceAttributes(ScoreInfo s,DifficultyAttributes d);
        public PerformanceAttributes Run(ScoreInfo s,DifficultyAttributes d)=>CreatePerformanceAttributes(s,d);
    }
}
namespace osu.Game.Rulesets.Mania.Difficulty {
    public class ManiaDifficultyAttributes : osu.Game.Rulesets.Difficulty.DifficultyAttributes {}
    public class ManiaPerformanceAttributes : osu.Game.Rulesets.Difficulty.PerformanceAttributes { public double Difficulty {get;set;} }
}
namespace osu.Game.Rulesets.Difficulty.Utils {
    public static class DiffUtils {
        public static double Pow(double x,double exponent)=>Math.Pow(x,exponent);
        public static double Logistic(double x,double midpointOffset,double multiplier,double maxValue=1)=>maxValue/(1+Math.Exp(multiplier*(midpointOffset-x)));
    }
}
namespace osu.Game.Rulesets.Scoring {
    public class HitWindows { public static readonly HitWindows Empty=new(); public double WindowFor(HitResult r)=>0; }
    public abstract class JudgementProcessor {
        protected virtual void ApplyResultInternal(JudgementResult r) {} protected virtual void RevertResultInternal(JudgementResult r) {}
        protected virtual void Reset(bool storeResults) {} public virtual void ApplyBeatmap(IBeatmap b)=>Reset(true);
        public void ApplyResult(JudgementResult r)=>ApplyResultInternal(r);
    }
    // DrainingHealthProcessor's real-time drain graph is irrelevant to mania (its drain rate is zero).
    public abstract class DrainingHealthProcessor(double drainStartTime) : HealthProcessor {
        protected double DrainStartTime=drainStartTime; protected IBeatmap Beatmap=null!; public double DrainRate {get;private set;}
        public override void ApplyBeatmap(IBeatmap b) {Beatmap=b;base.ApplyBeatmap(b);}
        protected override void Reset(bool storeResults) {base.Reset(storeResults);if(storeResults)DrainRate=ComputeDrainRate();}
        protected abstract double ComputeDrainRate();
        protected override bool CheckDefaultFailCondition(JudgementResult r)=>r.Judgement.MaxResult.IsBonus()||r.Type==HitResult.IgnoreHit?false:base.CheckDefaultFailCondition(r);
    }
    public class ScoreProcessor(object ruleset) {
        public osu.Framework.Bindables.BindableDouble Accuracy=new(1),MinimumAccuracy=new(),MaximumAccuracy=new(1);
        public osu.Framework.Bindables.Bindable<int> Combo=new(),HighestCombo=new();
        public osu.Framework.Bindables.Bindable<long> TotalScore=new(),TotalScoreWithoutMods=new();
        protected Dictionary<HitResult,int> ScoreResultCounts=[];
        protected bool ApplyNewJudgementsWhenFailed=false;
        private double currentMaximumBaseScore,currentBaseScore,maximumBaseScore,currentComboPortion,maximumComboPortion,currentBonusPortion,scoreMultiplier;
        private int currentAccuracyJudgementCount,maximumAccuracyJudgementCount;
        protected virtual IEnumerable<HitObject> EnumerateHitObjects(IBeatmap b)=>b.HitObjects;
        protected virtual double ComputeTotalScore(double c,double a,double b)=>0;
        protected virtual double GetComboScoreChange(JudgementResult r)=>0;
        protected virtual double GetBonusScoreChange(JudgementResult r)=>GetBaseScoreForResult(r.Type);
        public virtual ScoreRank RankFromScore(double a,IReadOnlyDictionary<HitResult,int> s)=>a>=.95?ScoreRank.S:a>=.9?ScoreRank.A:a>=.8?ScoreRank.B:a>=.7?ScoreRank.C:ScoreRank.D;
        /* BASE_SCORE */
        protected void ApplyScoreChange(JudgementResult r)=>updateScore();
        /* UPDATE_SCORE */
        public void Configure(int total,double multiplier) {
            maximumAccuracyJudgementCount=total;maximumBaseScore=305*total;scoreMultiplier=multiplier;
            for(int i=1;i<=total;i++)maximumComboPortion+=GetComboScoreChange(new(){Type=HitResult.Perfect,ComboAfterJudgement=i});
            updateScore();
        }
        public void ApplyResult(JudgementResult result) { /* APPLY_RESULT */ }
        public int[] Counts=>new[]{HitResult.Perfect,HitResult.Great,HitResult.Good,HitResult.Ok,HitResult.Meh,HitResult.Miss}.Select(j=>ScoreResultCounts.GetValueOrDefault(j)).ToArray();
    }
}
