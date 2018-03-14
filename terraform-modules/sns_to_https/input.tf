variable "sns_topic_name" {
  description = "The Name of the SNS Topic for posting Parameter Store updates"
  default     = "Parameter Store Update"
}

variable "https_server_url" {
  description = "The https url to which Parameter Store Updates will be Posted.  Basically, the https address to src/index.js"
}