data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "sns_accept_events_from_cloudwatch" {
    statement {
        sid       = "TrustCloudWatchToPublishEventsToTopic"
        effect    = "Allow"
        actions   = [
            "sns:Publish"
        ]
        principals {
            type        = "Service"
            identifiers = ["events.amazonaws.com"]
        }
        resources = ["${format("arn:aws:sns:%s:%s:%s", data.aws_region.current.name, data.aws_caller_identity.current.account_id, var.sns_topic_name)}"]
    }
}

resource "aws_sns_topic" "main" {
    name   = "${var.sns_topic_name}"
    policy = "${data.aws_iam_policy_document.sns_accept_events_from_cloudwatch.json}"
}

resource "aws_sns_topic_subscription" "base" {
    topic_arn              = "${aws_sns_topic.main.arn}"
    protocol               = "https"
    endpoint               = "${var.https_server_url}"
    endpoint_auto_confirms = true
}

resource "aws_cloudwatch_event_rule" "main" {
    name          = "parameter-store-change"
    description   = "Capture each change to Parameter Store"
    event_pattern = <<JSON
{
    "source": [
        "aws.ssm"
    ],
    "detail-type": [
        "Parameter Store Change"
    ]
}
JSON
}

resource "aws_cloudwatch_event_target" "main" {
    rule = "${aws_cloudwatch_event_rule.main.name}"
    arn  = "${aws_sns_topic.main.arn}"
}